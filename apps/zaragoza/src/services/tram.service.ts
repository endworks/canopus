import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';

import {
  TramAlertResponse,
  TramLineResponse,
  TramLinesResponse,
  TramStationResponse,
  TramStationsResponse,
} from '../models/tram.interface';
import {
  activeAlerts,
  AlertSource,
  alertsForStation,
  AlertStore,
  toAlertResponse,
} from '../alert-store';
import { toLineResponse, toLinesResponse } from '../lines';
import {
  capitalizeEachWord,
  compareArrivalTimes,
  compareLineIds,
  fixWords,
  normalizeStreet,
  notFoundById,
} from '../utils';
import { ErrorResponse } from '@canopus/shared';
import {
  fetchWithTimeout,
  postWithTimeout,
  upstreamFailure,
} from '@canopus/nest';
import { AlertReader, LineRoute } from '../alert-reader';
import { articleText, ScrapedAlert } from '../alerts';
import {
  TramAlert,
  TramAlertDocument,
  TramLine,
  TramLineDocument,
  TramStation,
  TramStationDocument,
} from '../schemas/tram.schema';
import {
  boardsOf,
  BuiltTramLine,
  BuiltTramNetwork,
  OperatorLine,
  parseOperatorLine,
  TRAM_LINE_ID,
  tramLineId,
} from '../tram-line';
import {
  alertCategoryIds,
  alertId,
  categoriesQuery,
  parseLiveAlerts,
  parseWordPressAlerts,
  postArticle,
  postsQuery,
  tramFrontPageURL,
  tramSiteURL,
  WordPressCategory,
  WordPressPost,
} from '../tram-alerts';

/** Where the operator's own site fetches its line, stops and shape from. */
const tramAjaxURL = `${tramSiteURL}/wp-admin/admin-ajax.php`;

const tramStationURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia/';

/** How long an arrival time is worth showing. */
const STATION_TTL = 10000;

const upsertById = <T extends { id: string }>(
  id: string,
  data: Partial<T>,
) => ({
  updateOne: { filter: { id }, update: { $set: data }, upsert: true },
});

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

@Injectable()
export class TramService {
  private readonly logger = new Logger(TramService.name);

  /** The operator's alterations, kept the way both networks keep them. */
  private readonly alerts: AlertStore;

  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(TramStation.name)
    private tramStationModel: Model<TramStationDocument>,
    @InjectModel(TramLine.name)
    private tramLineModel: Model<TramLineDocument>,
    @InjectModel(TramAlert.name)
    private tramAlertModel: Model<TramAlertDocument>,
    private httpService: HttpService,
    private alertReader: AlertReader,
  ) {
    this.alerts = new AlertStore(
      this.tramAlertModel,
      this.alertReader,
      this.logger,
    );
  }

  // Stations
  public async getStations(): Promise<TramStationsResponse | ErrorResponse> {
    try {
      const cache: TramStationsResponse =
        await this.cacheManager.get('tram/stations');
      if (cache) return cache;

      const resp: TramStationsResponse = {};
      const stations = await this.getAllStations();
      stations.forEach((station) => {
        const { _id, times, ...stationWithoutId } = station;
        resp[station.id] = stationWithoutId;
      });
      await this.cacheManager.set(`tram/stations`, resp);
      return resp;
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
        },
        exception.message,
      );
    }
  }

  // Station
  /**
   * A stop: where it is, what is due, and what is altered on its line.
   *
   * The city's board is one road and there is no second one, so a stop it
   * cannot answer for is a failure of the source. What is altered is not the
   * source's to fail at — it comes from what this service already stored — so
   * it is attached after the walk to the city, where a failure of ours is not
   * reported as an outage of theirs.
   */
  public async getStation(
    id: string,
  ): Promise<TramStationResponse | ErrorResponse> {
    const cache: TramStationResponse = await this.cacheManager.get(
      `tram/stations/${id}`,
    );
    if (cache) return cache;

    const resp = await this.readStation(id);
    resp.alerts = alertsForStation(await this.getAlerts(), id, resp.lines);

    await this.cacheManager.set(`tram/stations/${id}`, resp, STATION_TTL);
    return resp;
  }

  private async readStation(id: string): Promise<TramStationResponse> {
    try {
      const backup = await this.getStationById(id);

      const resp: TramStationResponse = {
        id: id,
        street: null,
        lines: [],
        times: [],
        coordinates: [],
        // One road for a tram stop, so it is the one that answers.
        source: 'api',
        sourceUrl: null,
        type: 'tram',
      };

      if (backup) {
        resp.street = backup.street;
        resp.lines = backup.lines;
        resp.coordinates = backup.coordinates;

        if (!Array.isArray(resp.lines)) {
          if ((resp.lines as string).includes(',')) {
            resp.lines = (resp.lines as string)
              .split(',')
              .map((line) => line.trim());
          } else {
            resp.lines = [resp.lines];
          }
        }
      }

      // Both platforms of a place the tram calls at each way, and the one
      // board there is where it calls at only one — see `boardsOf`. Asking a
      // one-way stop for its non-existent other platform is what used to
      // leave half of them without a time.
      const boards = boardsOf(id);
      const answers = await Promise.allSettled(
        boards.map((board) =>
          fetchWithTimeout<any>(this.httpService, tramStationURL + board),
        ),
      );

      // What answered, and never mind what did not. A place has two boards and
      // they fail one at a time, so one that does is a reason to show the
      // other's arrivals rather than none: `Promise.all` here meant a single
      // flaky board left a stop with no times at all, at the terminus where
      // one of the two is always empty anyway.
      const stations = answers.flatMap((answer, index) => {
        if (answer.status === 'fulfilled') return [answer.value];
        this.logger.warn(
          `The city's board ${boards[index]} did not answer for tram stop ${id}: ${answer.reason?.message}`,
        );
        return [];
      });
      // Unless none of them did, which is the source failing rather than a
      // stop with nothing due.
      if (!stations.length) {
        const [failed] = answers;
        throw failed?.status === 'rejected' ? failed.reason : notFoundById(id);
      }

      stations.forEach((station) => {
        resp.times.push(
          ...(station.destinos?.map((destino) => {
            return {
              // The feed says `1` where the network says `L1`, and a board
              // that disagrees with the line list is a board nothing matches.
              line: tramLineId(destino.linea),
              destination: capitalizeEachWord(fixWords(destino.destino)),
              time: `${destino.minutos} min.`,
            };
          }) || []),
        );
      });

      resp.times.sort((a, b) => compareArrivalTimes(a.time, b.time));

      return resp;
    } catch (exception) {
      throw upstreamFailure(exception, 'The tram API', notFoundById(id));
    }
  }

  // Lines
  public async getLines(): Promise<TramLinesResponse> {
    return this.cacheManager.wrap('tram/lines', async () =>
      toLinesResponse(await this.getAllLines(), compareLineIds),
    );
  }

  // Line
  public async getLine(id: string): Promise<TramLineResponse> {
    return this.cacheManager.wrap(`tram/lines/${id}`, async () => {
      const line = await this.getLineById(id);
      if (!line) throw notFoundById(id);
      return toLineResponse(line, { withPath: true });
    });
  }

  // Alerts
  /**
   * The alterations in force right now.
   *
   * What is stored is cached; which of it is still in force is not. That line
   * matters because the filter turns on today's date and a cache entry outlives
   * the midnight it was built before — an alert that ended yesterday would go on
   * being served all morning, which is the one thing an end date exists to stop.
   */
  public async getAlerts(): Promise<TramAlertResponse[]> {
    const stored = await this.cacheManager.wrap('tram/alerts', () =>
      this.alerts.all(),
    );
    return activeAlerts(stored).map(toAlertResponse);
  }

  /**
   * Rebuilds the line, and the stops' membership of it, from the stops stored.
   *
   * Everything about it is the operator's own. Their site fetches the line in
   * order to draw it, and that answer carries the stops of each direction in
   * route order, the code each stop is known by, and the track itself. All of
   * it used to be worked out here from the stops we happened to hold, which
   * got the order roughly right and the pairing wrong.
   *
   * A run that cannot read the line leaves the stored one exactly as it was
   * and goes on to the alerts, which are worth having on their own.
   */
  public async getLinesUpdate(): Promise<TramLinesResponse> {
    const [storedLines, storedStations] = await Promise.all([
      this.getAllLines(),
      this.getAllStations(),
    ]);
    const linesBackup = new Map(storedLines.map((line) => [line.id, line]));

    const network = await this.fetchOperatorLine();
    if (!network) {
      this.logger.warn(
        'The tram operator published no line to read; leaving the stored one as it is',
      );
    } else {
      const lineOps = this.lineUpdates(network.line, linesBackup);
      if (lineOps.length) {
        await this.tramLineModel.bulkWrite(lineOps, { ordered: false });
      }

      // Anything stored that this run did not read is not a line this network
      // runs. Deleted rather than hidden, which is what the bus does with a
      // line its source withdrew: a withdrawn bus line may come back and wants
      // its stops kept, whereas the tram's line is read whole on every run, so
      // a stored line the run did not produce is the same line under a name we
      // have stopped using. Only ever reached with a line read, so a run that
      // read nothing deletes nothing.
      const stale = [...linesBackup.keys()].filter(
        (id) => id !== network.line.id,
      );
      if (stale.length) {
        await this.tramLineModel.deleteMany({ id: { $in: stale } });
        this.logger.log(
          `Dropped the tram line${stale.length > 1 ? 's' : ''} ${stale.join(', ')}: not a line this network runs`,
        );
      }

      const stationOps = this.stationUpdates(network, storedStations);
      if (stationOps.length) {
        await this.tramStationModel.bulkWrite(stationOps, { ordered: false });
      }

      const goneStations = this.retiredStations(network, storedStations);
      if (goneStations.length) {
        await this.tramStationModel.deleteMany({ id: { $in: goneStations } });
        this.logger.log(
          `Dropped ${goneStations.length} tram stop record(s) this line does not have: ${goneStations.join(', ')}`,
        );
      }

      this.logger.log(
        `Read the tram line as ${network.line.stations.length} stops and ${network.line.path.length} points, and wrote ${stationOps.length} stop records`,
      );
    }

    const line = network?.line ?? this.asBuilt(linesBackup.get(TRAM_LINE_ID));
    await this.alerts.sync(this.alertSource(), (lineIds) =>
      this.routesOf(lineIds, line, network?.stations ?? storedStations),
    );

    await this.cacheManager.clear();
    return this.getLines();
  }

  /**
   * The line as the operator publishes it, or nothing.
   *
   * Their site draws its map in the browser and fetches what to draw, so the
   * shape is in no page: it is one call, behind a nonce the same endpoint
   * hands out for the asking, and it answers with the stops of each direction
   * in route order and the track as a couple of hundred points. The referer is
   * not decoration — the endpoint answers 403 without one.
   */
  private async fetchOperatorLine(): Promise<BuiltTramNetwork | null> {
    try {
      const nonce = await this.fetchLineNonce();
      if (!nonce) return null;

      const feed = await postWithTimeout<OperatorLine>(
        this.httpService,
        tramAjaxURL,
        { action: 'dosnet_tranvias_lineas', _ajax_nonce: nonce },
        { headers: { Referer: `${tramSiteURL}/` } },
      );
      const network = parseOperatorLine(feed);
      if (!network) {
        this.logger.warn('The tram line feed carried no line to read');
      }
      return network;
    } catch (exception) {
      this.logger.warn(
        `Could not read the tram line from the operator: ${exception.message}`,
      );
      return null;
    }
  }

  /** Minted for the asking, and the line endpoint will not answer without it. */
  private async fetchLineNonce(): Promise<string | undefined> {
    const answer = await postWithTimeout<{ data?: string }>(
      this.httpService,
      tramAjaxURL,
      { action: 'dosnet_tranvias_get_nonce' },
      { headers: { Referer: `${tramSiteURL}/` } },
    );
    if (!answer?.data) {
      this.logger.warn('The tram operator issued no nonce for its line feed');
    }
    return answer?.data;
  }

  private lineUpdates(
    built: BuiltTramLine,
    linesBackup: Map<string, TramLine>,
  ) {
    const backup = linesBackup.get(built.id);
    const unchanged =
      backup &&
      backup.name === built.name &&
      sameList(backup.stations ?? [], built.stations) &&
      sameList(backup.stationsReturn ?? [], built.stationsReturn);
    // The stops and the shape come out of the same read, so an unchanged run
    // rewrites neither — and `lastUpdated` stays the day the line last
    // actually changed rather than the day it was last looked at.
    if (unchanged) return [];

    return [
      upsertById<TramLine>(built.id, {
        ...built,
        lastUpdated: new Date().toISOString(),
        // Nothing withdraws the line: the operator publishes one line and
        // this is it, so there is no listing that could stop offering it.
        withdrawn: false,
      }),
    ];
  }

  /**
   * Each stop, as the operator names and places it.
   *
   * Where it stands and what it is called come from the same read as the line,
   * so a stop cannot be drawn in one place and listed in another. Its name is
   * the combined one — both places where the two directions call at different
   * ones — which is the whole reason a stop is written here rather than left
   * as the city seeded it.
   *
   * The lines at a stop are what this run read, not what it read added to what
   * was stored. The operator publishes the tram network whole on every run, so
   * there is no line at a stop this update does not know about, and a union
   * with history could only ever accumulate: a stop told it was on `1` kept it
   * and gained `L1`, and would have carried both for good.
   */
  private stationUpdates(
    network: BuiltTramNetwork,
    stored: Map<string, TramStation> | TramStation[],
  ) {
    const storedById = new Map(
      (Array.isArray(stored) ? stored : [...stored.values()]).map((station) => [
        station.id,
        station,
      ]),
    );
    const updates = network.stations.flatMap((station) => {
      const backup = storedById.get(station.id);
      const unchanged =
        backup &&
        backup.street === station.street &&
        sameList(backup.coordinates ?? [], station.coordinates) &&
        sameList(backup.lines ?? [], [network.line.id]);
      return unchanged
        ? []
        : [
            upsertById<TramStation>(station.id, {
              id: station.id,
              street: station.street,
              coordinates: station.coordinates,
              lines: [network.line.id],
              type: 'tram',
            }),
          ];
    });

    return updates;
  }

  /**
   * The stop records this network does not have.
   *
   * Dropped rather than emptied. These are not stops that closed: they are the
   * ids a previous pairing invented — a place stored under a code shared by
   * two stops a street apart, which named one of them and pinned the pair
   * between them, and which no board answers for. A reader that had one of
   * those in its cache would go on asking for it forever.
   *
   * Only ever reached with a line read, and the line is read whole, so a run
   * that saw nothing removes nothing.
   */
  private retiredStations(
    network: BuiltTramNetwork,
    stored: TramStation[],
  ): string[] {
    const known = new Set(network.stations.map((station) => station.id));
    return stored.map((station) => station.id).filter((id) => !known.has(id));
  }

  /** A stored line, in the shape a freshly built one has. */
  private asBuilt(line?: TramLine): BuiltTramLine | null {
    return line
      ? {
          id: line.id,
          name: line.name,
          stations: line.stations ?? [],
          stationsReturn: line.stationsReturn ?? [],
          path: line.path ?? [],
          pathReturn: line.pathReturn ?? [],
        }
      : null;
  }

  /**
   * The stops of each line an alert names, in route order and named by their
   * street: what "entre Plaza España y Gran Vía" has to be resolved against.
   *
   * Both legs, and each stop once: a notice names a place, and which of its two
   * platforms it means is not something the words settle. A line that could not
   * be built contributes nothing rather than an empty route — the difference
   * between "these are the stops" and "we do not know the stops" is the
   * difference between a notice that can be narrowed and one that must not be.
   */
  private routesOf(
    lineIds: string[],
    line: BuiltTramLine | null,
    stations: { id: string; street: string }[],
  ): LineRoute[] {
    if (!line) return [];
    const streets = new Map(
      stations.map((station) => [station.id, station.street]),
    );
    const seen = new Set<string>();
    const stops = [...line.stations, ...line.stationsReturn]
      .filter((id) => !seen.has(id) && seen.add(id))
      .map((id) => ({ id, street: normalizeStreet(streets.get(id) ?? '') }));
    return lineIds.includes(line.id) && stops.length
      ? [{ line: line.id, stations: stops }]
      : [];
  }

  /**
   * Where the tram operator publishes its alterations, and how a notice reads.
   *
   * Two places, and they are not two roads to the same thing — they are two
   * different halves of it, so both are read on every run and merged.
   *
   * The block at the top of the front page is what is wrong with the service
   * right now: it appears when something happens and goes when it is over. The
   * posts are what was announced — the extended hours for a festival, the
   * reinforcement for a match — and stay up afterwards. A traveller wants the
   * first; a client listing what is on wants both.
   *
   * Where the block links to its own post the two are one alert, because they
   * are keyed on the same slug.
   */
  private alertSource(): AlertSource {
    const articles = new Map<string, string>();
    return {
      mode: 'tram',
      list: async () => {
        articles.clear();
        const [live, published] = await Promise.all([
          this.fetchLiveAlerts(),
          this.fetchPublishedAlerts(articles),
        ]);
        // The live block first, so that where the same alteration is in both
        // it is the post's date and words that are kept — the block carries
        // neither — and the reading is done against the fuller of the two.
        const alerts = new Map(live.map((alert) => [alert.id, alert]));
        published.forEach((alert) => alerts.set(alert.id, alert));
        return [...alerts.values()];
      },
      article: async (alert) =>
        articles.get(alert.id) ?? this.fetchArticle(alert.url),
    };
  }

  /** What is wrong with the service right now, from the operator's own block. */
  private async fetchLiveAlerts(): Promise<ScrapedAlert[]> {
    const html = await this.fetch<unknown>(tramFrontPageURL);
    if (typeof html !== 'string') return [];
    const live = parseLiveAlerts(html);
    if (live.length) {
      this.logger.log(
        `The tram is showing ${live.length} alterations in force`,
      );
    }
    return live;
  }

  /** What the operator has announced, from the posts it files them under. */
  private async fetchPublishedAlerts(
    articles: Map<string, string>,
  ): Promise<ScrapedAlert[]> {
    try {
      const categories = await fetchWithTimeout<WordPressCategory[]>(
        this.httpService,
        categoriesQuery(),
      );
      const ids = alertCategoryIds(categories);
      if (!ids.length) {
        // Every post on the site would be an alteration if this fell through
        // to an unfiltered listing, so it does not: no category, nothing from
        // here, and the block at the top still answers for what is in force.
        this.logger.warn(
          'The tram site lists no category an alteration is filed under',
        );
        return [];
      }

      const posts = await fetchWithTimeout<WordPressPost[]>(
        this.httpService,
        postsQuery(ids),
      );
      (posts ?? []).forEach((post) => {
        const id = alertId(post.link ?? '', post.slug);
        const words = postArticle(post);
        if (id && words) articles.set(id, words);
      });
      return parseWordPressAlerts(posts);
    } catch (exception) {
      this.logger.warn(
        `Could not read the tram alterations from the site's API: ${exception.message}`,
      );
      return [];
    }
  }

  /** A read that costs the run nothing when it fails: an extra, not the line. */
  private async fetch<T>(url: string): Promise<T | undefined> {
    try {
      return await fetchWithTimeout<T>(this.httpService, url);
    } catch (exception) {
      this.logger.warn(`Could not read ${url}: ${exception.message}`);
      return undefined;
    }
  }

  private async fetchArticle(url: string): Promise<string> {
    try {
      const html = await fetchWithTimeout<string>(this.httpService, url);
      return articleText(html);
    } catch (exception) {
      this.logger.warn(`Could not read ${url}: ${exception.message}`);
      return '';
    }
  }

  async getAllStations() {
    return this.tramStationModel.find().sort({ id: 1 }).lean().exec();
  }

  async getAllLines() {
    return this.tramLineModel.find().sort({ id: 1 }).lean().exec();
  }

  async getAllAlerts() {
    return this.alerts.all();
  }

  async getStationById(id: string) {
    return this.tramStationModel.findOne({ id }).lean();
  }

  async getLineById(id: string) {
    return this.tramLineModel.findOne({ id }).lean();
  }

  async saveStation(data: Partial<TramStation>) {
    return this.tramStationModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { returnDocument: 'after', upsert: true },
      )
      .lean();
  }
}
