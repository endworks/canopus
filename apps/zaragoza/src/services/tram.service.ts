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
import { BuiltTramLine, buildTramLine, TRAM_LINE_ID } from '../tram-line';
import {
  alertCategoryIds,
  alertId,
  categoriesQuery,
  parseIncidentListing,
  parseWordPressAlerts,
  postArticle,
  postsQuery,
  tramIncidentsURL,
  WordPressCategory,
  WordPressPost,
} from '../tram-alerts';

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
              line: destino.linea,
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

    const built = buildTramLine(this.stationsOfLine(stations, TRAM_LINE_ID));
    if (!built) {
      this.logger.warn(
        'Not enough stored tram stops to build the line; leaving it as it is',
      );
    } else {
      const lineOps = this.lineUpdates(built, linesBackup);
      if (lineOps.length) {
        await this.tramLineModel.bulkWrite(lineOps, { ordered: false });
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
   * The stops that make up a line.
   *
   * A stop says which lines call at it, and that is what is used — except on a
   * network whose stops have never been told, where every tram stop is on the
   * only line there is. The second half of that is what a first run is: the
   * link is written by this update, so before the first one nothing carries it.
   */
  private stationsOfLine(stations: TramStation[], lineId: string) {
    const assigned = stations.filter((station) =>
      station.lines?.includes(lineId),
    );
    return assigned.length ? assigned : stations;
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

  private stationUpdates(built: BuiltTramLine, stations: TramStation[]) {
    const onTheLine = new Set([...built.stations, ...built.stationsReturn]);
    return stations.flatMap((station) => {
      const lines = onTheLine.has(station.id)
        ? [...new Set([...(station.lines ?? []), built.id])].sort(
            compareLineIds,
          )
        : (station.lines ?? []).filter((line) => line !== built.id);
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
   * Two roads to the same listing. The REST API the site's own WordPress
   * serves is the first: it dates and identifies each notice itself and hands
   * over its words with the listing, so reading one costs no second request.
   * The incidents page is the second, for a site that has shut the API off —
   * read from the markup every WordPress theme shares rather than this one's
   * classes, because a theme is redesigned and `<article>` is not.
   *
   * The notices the API handed over are kept for the duration of one listing,
   * so an alteration is fetched at most once whichever road answered.
   */
  private alertSource(): AlertSource {
    const articles = new Map<string, string>();
    return {
      mode: 'tram',
      list: async () => {
        articles.clear();
        const published = await this.fetchApiAlerts(articles);
        return published.length ? published : this.fetchListedAlerts();
      },
      article: async (alert) =>
        articles.get(alert.id) ?? this.fetchArticle(alert.url),
    };
  }

  private async fetchApiAlerts(
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
        // to an unfiltered listing, so it does not: no category, no alerts
        // from here, and the page is read instead.
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

  private async fetchListedAlerts(): Promise<ScrapedAlert[]> {
    try {
      const html = await fetchWithTimeout<string>(
        this.httpService,
        tramIncidentsURL,
      );
      return parseIncidentListing(html);
    } catch (exception) {
      this.logger.warn(
        `Could not read ${tramIncidentsURL}: ${exception.message}`,
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
