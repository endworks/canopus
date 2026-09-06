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
import { fetchWithTimeout, upstreamFailure } from '@canopus/nest';
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
  BuiltTramLine,
  buildTramLine,
  TRAM_LINE_ID,
  tramLineId,
} from '../tram-line';
import { parseGeoJsonPaths, parseKmlPath } from '../geo';
import { mapDataLinks, parseMapPath, tramMapPages } from '../tram-map';
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

const tramStationURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia/';

/** How long an arrival time is worth showing. */
const STATION_TTL = 10000;

/**
 * How many of a page's map files are worth fetching.
 *
 * A WordPress site references `.json` everywhere — a block's settings, a
 * theme's manifest, a plugin's translations — and the route, if it is in a
 * file at all, is one of the first the page names.
 */
const maxMapFiles = 5;

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

      const stations = await Promise.all(
        ['1', '2'].map((platform) =>
          fetchWithTimeout<any>(
            this.httpService,
            tramStationURL + `${id.slice(0, id.length - 1) + platform}`,
          ),
        ),
      );

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
   * Unlike the bus, there is no route file to read: the operator publishes no
   * geometry and the city's stop dataset says which stops exist, not which line
   * they are on or in what order. So the line is worked out from the stops
   * themselves — see `tram-line.ts` — and written down, rather than recomputed
   * on every read.
   *
   * A run that cannot build the line leaves the stored one exactly as it was
   * and goes on to the alerts, which are worth having on their own.
   */
  public async getLinesUpdate(): Promise<TramLinesResponse> {
    const [storedLines, stations] = await Promise.all([
      this.getAllLines(),
      this.getAllStations(),
    ]);
    const linesBackup = new Map(storedLines.map((line) => [line.id, line]));

    const path = await this.fetchDrawnRoute();
    const built = buildTramLine(this.stationsOfLine(stations, TRAM_LINE_ID), {
      path,
    });
    if (!built) {
      this.logger.warn(
        'Not enough stored tram stops to build the line; leaving it as it is',
      );
    } else {
      const lineOps = this.lineUpdates(built, linesBackup);
      if (lineOps.length) {
        await this.tramLineModel.bulkWrite(lineOps, { ordered: false });
      }

      // Anything stored that this run did not build is not a line this
      // network runs. Deleted rather than hidden, which is what the bus does
      // with a line its source stopped offering: a withdrawn bus line may
      // come back and wants its stops kept, whereas everything here is
      // derived from the stops on every run, so a stored line the run did not
      // produce is not a line at all — it is the same line under a name we
      // have stopped using, and leaving it would put it in every listing
      // beside the one that replaced it. Only ever reached with a line built,
      // so a run that could read nothing deletes nothing.
      const stale = [...linesBackup.keys()].filter((id) => id !== built.id);
      if (stale.length) {
        await this.tramLineModel.deleteMany({ id: { $in: stale } });
        this.logger.log(
          `Dropped the tram line${stale.length > 1 ? 's' : ''} ${stale.join(', ')}: not a line this network runs`,
        );
      }
      // A stop is on the line the moment the line is built from it. Stored
      // here so a stop knows its own line without the line being read back,
      // which is what puts a line-wide alteration on a stop's board.
      const stationOps = this.stationUpdates(built, stations);
      if (stationOps.length) {
        await this.tramStationModel.bulkWrite(stationOps, { ordered: false });
      }
      this.logger.log(
        `Updated the tram line with ${built.stations.length} stops and ${stationOps.length} stop records`,
      );
    }

    const line = built ?? this.asBuilt(linesBackup.get(TRAM_LINE_ID));
    await this.alerts.sync(this.alertSource(), (lineIds) =>
      this.routesOf(lineIds, line, stations),
    );

    await this.cacheManager.clear();
    return this.getLines();
  }

  /**
   * The route the operator's own map draws, or nothing.
   *
   * The site puts a Google Maps widget on its line page, and a widget like
   * that builds its map in the browser: whatever it draws has to be in the
   * document by the time it loads, either written into the page's scripts or
   * in a file the page points at. Both are read — the scripts first, because a
   * page that carries its shape needs no second request — and the longest
   * shape any of them yields is the route.
   *
   * It is the whole difference between a route drawn kerb by kerb and one
   * drawn as its stops joined up, and between stops put in order by the line
   * and stops put in order by walking between them. Failing at it costs
   * exactly that: a run that reads no route builds the line from its stops,
   * which is what every run did before this.
   */
  private async fetchDrawnRoute(): Promise<number[][]> {
    const found: number[][][] = [];

    for (const page of tramMapPages(tramSiteURL)) {
      const html = await this.fetchPage(page);
      if (!html) continue;

      const drawn = parseMapPath(html);
      if (drawn.length) found.push(drawn);

      // A widget that fetches its shape rather than carrying it. These are the
      // operator's own files, and a KML is the same thing the bus routes are.
      // A handful of them: a WordPress site is full of `.json` that is a
      // plugin's settings, and the route is not the twentieth one of those.
      for (const link of mapDataLinks(html, page).slice(0, maxMapFiles)) {
        found.push(...(await this.fetchMapFile(link)));
      }
    }

    const best = found.sort((a, b) => b.length - a.length)[0] ?? [];
    if (best.length) {
      this.logger.log(`Read the tram route as ${best.length} points`);
    } else {
      this.logger.warn(
        'No tram route could be read from the operator; drawing the line through its stops',
      );
    }
    return best;
  }

  /**
   * One map file, however it turns out to be written.
   *
   * What it is decides how it is read rather than what it is called: these are
   * served under every extension there is, and axios has already turned a JSON
   * body into an object by the time it arrives here.
   */
  private async fetchMapFile(url: string): Promise<number[][][]> {
    const body = await this.fetch<unknown>(url);
    if (!body) return [];
    if (typeof body !== 'string') return parseGeoJsonPaths(body);

    const kml = parseKmlPath(body);
    if (kml.length) return [kml];
    try {
      return parseGeoJsonPaths(JSON.parse(body));
    } catch {
      return [];
    }
  }

  private async fetchPage(url: string): Promise<string | undefined> {
    const body = await this.fetch<unknown>(url);
    return typeof body === 'string' ? body : undefined;
  }

  /** A read that costs the run nothing when it fails: the route is an extra. */
  private async fetch<T>(url: string): Promise<T | undefined> {
    try {
      return await fetchWithTimeout<T>(this.httpService, url);
    } catch (exception) {
      this.logger.warn(`Could not read ${url}: ${exception.message}`);
      return undefined;
    }
  }

  /**
   * The stops that make up a line.
   *
   * A stop that belongs to another line is left out; everything else is
   * offered, and what is actually on the route is settled by the route. On a
   * network whose stops have never been told anything, that is every tram
   * stop there is — which is what a first run reads, since the link between a
   * stop and its line is written by this update.
   */
  private stationsOfLine(stations: TramStation[], lineId: string) {
    // A stop is a candidate for this line if it says it is on it, or if it
    // says nothing at all: a stop with no lines is one no run has placed yet,
    // or one a run left off, and either way the way back onto the line is to
    // be offered to it again. Only a stop that belongs to some other line is
    // left out, which is the one thing this filter can say with certainty —
    // "is already on this line" would be circular, and would strand for good
    // any stop a single bad run dropped.
    const candidates = stations.filter(
      (station) => !station.lines?.length || station.lines.includes(lineId),
    );
    return candidates.length ? candidates : stations;
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
        // Nothing withdraws the line: it is not read from a listing that
        // could stop offering it, it is built from the stops we hold.
        withdrawn: false,
      }),
    ];
  }

  /**
   * Which lines call at each stop, as this run worked them out.
   *
   * What the run built, rather than what the run built added to whatever was
   * stored. Every tram line here is derived from the stops themselves on every
   * run, so there is no line at a stop this update does not know about, and a
   * union with history could only ever accumulate: a stop that was told it was
   * on `1` kept it and gained `L1`, and would have carried both for good.
   */
  private stationUpdates(built: BuiltTramLine, stations: TramStation[]) {
    const onTheLine = new Set([...built.stations, ...built.stationsReturn]);
    return stations.flatMap((station) => {
      const lines = onTheLine.has(station.id) ? [built.id] : [];
      return sameList(station.lines ?? [], lines)
        ? []
        : [upsertById<TramStation>(station.id, { lines })];
    });
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
    stations: TramStation[],
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
    const html = await this.fetchPage(tramFrontPageURL);
    if (!html) return [];
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
