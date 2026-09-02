import { createHash } from 'node:crypto';

import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cache } from 'cache-manager';
import * as cheerio from 'cheerio';
import { Model } from 'mongoose';

import {
  BusAlertResponse,
  BusLineResponse,
  BusLinesResponse,
  BusStationResponse,
  BusStationsResponse,
} from '../models/bus.interface';
import { ErrorResponse, mapWithLimit } from '@canopus/shared';
import { fetchWithTimeout, postWithTimeout } from '@canopus/nest';
import { StationBase, ValueLabel } from '../models/common.interface';
import {
  BusAlert,
  BusAlertDocument,
  BusLine,
  BusLineDocument,
  BusStation,
  BusStationDocument,
} from '../schemas/bus.schema';
import {
  articleText,
  parseAlertsNonce,
  parseAlterations,
  ScrapedAlert,
} from '../alerts';
import { AlertReader, LineRoute } from '../alert-reader';
import {
  canonicalLineName,
  capitalize,
  capitalizeEachWord,
  compareLineIds,
  extraLineIds,
  fixWords,
  kmlLinksByLine,
  KmlForLine,
  normalizeLineId,
  normalizeStreet,
  pickCanonicalStreet,
} from '../utils';

const busApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/poste-autobus/tuzsa-';
const busWebURL =
  'https://zaragoza-pasobus.avanzagrupo.com/frm_esquemaparadatime.php?poste=';
const busLinesURL = 'https://zaragoza.avanzagrupo.com/lineas-y-horarios/';
// The line pages print an empty `#avisos` and fill it from here, so this is
// the only place the site says which alterations it is currently showing.
const busAlertsURL = 'https://zaragoza.avanzagrupo.com/wp-admin/admin-ajax.php';

// The endpoint answers three alterations at a time. The cap is what stops a
// paginator that never empties from walking the site until the run dies.
const maxAlertPages = 20;

// Articles come from the same WordPress site as everything else, so they are
// read a few at a time. A run that suddenly has dozens of new alerts is a
// listing that broke, not a city that stopped running: the cap keeps that from
// becoming a bill.
const maxConcurrentArticles = 3;
const maxAnalyzedAlerts = 10;

// avanzagrupo.com is a WordPress site: asking it for ~90 route files at once is
// how a working update starts looking like an outage.
const maxConcurrentLines = 6;

// A route file the site never published (a one-way line has no -2) means
// something quite different from one it could not serve.
type KmlDocument =
  | { status: 'read'; xml: string }
  | { status: 'missing' }
  | { status: 'failed' };

/**
 * A line's stops, each way round, or null when its route could not be read.
 *
 * Two lists rather than one. The site publishes a route file per direction —
 * `21-1.kml` and `21-2.kml` — and these used to be flattened together the
 * moment they were parsed, which made line 21 a single run of seventy-eight
 * stops instead of two of about thirty-nine. The boundary was thrown away at
 * the only point anything knew where it was, and no reader downstream could
 * put it back: the return leg is not the outbound one reversed, because a stop
 * on the other side of the road is a different stop with a different number.
 *
 * `back` is empty for a line that runs one way, which is a real thing here —
 * some of these are loops that come back to where they began.
 */
type FetchedRoute = {
  out: StationBase[];
  back: StationBase[];
  /** The shape each leg traces, from the same file its stops came from. */
  pathOut: number[][];
  pathBack: number[][];
} | null;

/** Every stop of a line, both ways, for the readers that want the whole set. */
const allStops = (route: FetchedRoute): StationBase[] =>
  route ? [...route.out, ...route.back] : [];

type ActiveLines = Map<string, string | undefined>;

// What one read of the lines page yields.
interface PublishedLines {
  lines: ValueLabel[];
  routeFiles: Map<string, string[]>;
}

/**
 * The line drawn on the ground, as the route file already carries it.
 *
 * Every one of these files holds a single `LineString` beside its stop
 * placemarks — the shape the bus actually traces, kerb by kerb, which is not
 * the run of its stops joined up: a line that goes round a block between two
 * stops looks, drawn straight, like it goes through the buildings.
 *
 * Five decimal places, about a metre. The files carry seven, which is
 * centimetres — a precision nobody looking at a bus route can see and which
 * costs a third of the payload to send.
 */
const parseKmlPath = (xml: string): number[][] => {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('LineString > coordinates')
    .toArray()
    .flatMap((el) =>
      $(el)
        .text()
        .trim()
        .split(/\s+/)
        .flatMap((point) => {
          // Longitude, latitude, and an altitude every one of these files
          // writes as nought.
          const [lon, lat] = point.split(',').map(Number);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
          return [[round5(lon), round5(lat)]];
        }),
    );
};

const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;

const parseKmlStations = (xml: string): StationBase[] => {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('Placemark')
    .toArray()
    .flatMap((el) => {
      const name = $(el).find('name').text().trim();
      const match = name.match(/poste\s*(\d+)\s*-\s*(.+)/i);
      if (!match) return [];
      const [lon, lat] = $(el)
        .find('coordinates')
        .text()
        .trim()
        .split(',')
        .map((part) => part.trim());
      return [
        { id: match[1], street: match[2].trim(), coordinates: [lon, lat] },
      ];
    });
};

// `withdrawn` is how the two halves of `hidden` recover on their own terms; it
// is bookkeeping, so it stays out of the response.
//
// The drawn shape is asked for rather than assumed. It is by far the largest
// thing a line carries — a couple of hundred coordinate pairs per leg against
// a couple of dozen stop ids — and the listing of every line is fetched by
// every reader at startup, where fifty of those shapes would be several
// hundred kilobytes nobody has asked to see. One line at a time, it is a few.
const toLineResponse = (
  { _id, withdrawn, path, pathReturn, ...line }: BusLine & { _id?: unknown },
  { withPath = false }: { withPath?: boolean } = {},
): BusLineResponse => ({
  ...line,
  ...(withPath ? { path: path ?? [], pathReturn: pathReturn ?? [] } : {}),
  // Out of listings either because the source withdrew the line or because
  // there is no route to draw for it.
  hidden: !!withdrawn || !line.stations?.length,
});

// Everything else an alert carries — when it was first seen, what its article
// hashed to, which lines came from that article — is how the record is kept up
// to date, and stays out of the response.
const toAlertResponse = (alert: BusAlert): BusAlertResponse => ({
  id: alert.id,
  title: alert.title,
  url: alert.url,
  date: alert.date ?? undefined,
  startDate: alert.startDate ?? undefined,
  endDate: alert.endDate ?? undefined,
  lines: alert.lines ?? [],
  stations: alert.stations ?? [],
  addedStations: alert.addedStations ?? [],
  scope: alert.scope ?? 'line',
});

/** A day, `YYYY-MM-DD`, so many days from today. */
const dayFrom = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * An alert with nothing left for its article to tell us.
 *
 * It was read, and what it was read to say includes the day it ends: it will
 * take itself out of the listings when that day passes, so re-reading it every
 * morning buys nothing. Until the eve of that day, when the one edit that
 * would matter — an alteration extended — is worth a look.
 */
const settled = (alert?: BusAlert): boolean =>
  !!alert?.articleHash && !!alert.endDate && alert.endDate > dayFrom(1);

/**
 * The alterations still in force, newest first.
 *
 * Being stored is most of the answer: a run only keeps what the site was still
 * showing, and drops the rest. So there is no age to judge here — an
 * alteration announced in January and still under way is still under way, and
 * guessing otherwise from its date is what used to hide it. An end date, where
 * an article gave one, retires it a day early rather than waiting for the
 * operator to take the notice down.
 */
const activeAlerts = (alerts: BusAlert[]): BusAlert[] => {
  const today = dayFrom(0);
  const announced = (alert: BusAlert) =>
    (alert.date ?? alert.firstSeen ?? '').slice(0, 10);
  return alerts
    .filter((alert) => !alert.endDate || alert.endDate >= today)
    .sort((a, b) => announced(b).localeCompare(announced(a)));
};

/**
 * The stops of each of these lines, in route order and named by their street.
 *
 * Taken from the routes this run just read, so a first run can narrow a notice
 * as well as a hundredth. A line whose route could not be read contributes
 * nothing rather than an empty route: the difference between "these are the
 * stops" and "we do not know the stops" is the difference between a notice
 * that can be narrowed and one that must not be.
 */
const routesOf = (
  lineIds: string[],
  routes: Map<string, FetchedRoute>,
): LineRoute[] =>
  lineIds.flatMap((line) => {
    const seen = new Set<string>();
    const stops = allStops(routes.get(line) ?? null)
      .filter((stop) => !seen.has(stop.id) && seen.add(stop.id))
      // The prose carries accents the KML drops; both sides have to be the
      // same words for the model to match them.
      .map(({ id, street }) => ({ id, street: normalizeStreet(street) }));
    return stops.length ? [{ line, stations: stops }] : [];
  });

const articleHash = (article: string) =>
  createHash('sha256').update(article).digest('hex');

/**
 * The reading an alert carries, or the one an unread alert carries: no dates,
 * no stops, the whole line, and no text on record as having been read.
 */
const readingOf = (alert?: BusAlert): ArticleReading => ({
  startDate: alert?.startDate ?? null,
  endDate: alert?.endDate ?? null,
  stations: alert?.stations ?? [],
  addedStations: alert?.addedStations ?? [],
  scope: alert?.scope ?? 'line',
  articleHash: alert?.articleHash,
});

/**
 * What an alert's article was read to say, and the text that was read. Every
 * field of it comes from one reading, so they cannot disagree about which
 * version of the notice they describe.
 */
type ArticleReading = Pick<
  BusAlert,
  | 'startDate'
  | 'endDate'
  | 'stations'
  | 'addedStations'
  | 'scope'
  | 'articleHash'
>;

/**
 * What a run learned. An alert with no entry is one this run learned nothing
 * about — its text had not changed, or nobody could read it — and whatever is
 * stored for it stands.
 */
type ArticleReadings = Map<string, ArticleReading>;

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const upsertById = <T extends { id: string }>(
  id: string,
  data: Partial<T>,
) => ({
  updateOne: { filter: { id }, update: { $set: data }, upsert: true },
});

@Injectable()
export class BusService {
  private readonly logger = new Logger(BusService.name);

  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(BusStation.name)
    private busStationModel: Model<BusStationDocument>,
    @InjectModel(BusLine.name)
    private busLineModel: Model<BusLineDocument>,
    @InjectModel(BusAlert.name)
    private busAlertModel: Model<BusAlertDocument>,
    private httpService: HttpService,
    private alertReader: AlertReader,
  ) {}

  // Stations
  public async getStations(): Promise<BusStationsResponse | ErrorResponse> {
    try {
      const cache: BusStationsResponse =
        await this.cacheManager.get('bus/stations');
      if (cache) return cache;
      const resp: BusStationsResponse = {};
      const stations = await this.getAllStations();
      stations.forEach((station) => {
        const { _id, times, ...stationWithoutId } = station;
        resp[station.id] = stationWithoutId;
      });
      await this.cacheManager.set(`bus/stations`, resp);
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
  public async getStation(
    id: string,
    source?: string,
  ): Promise<BusStationResponse | ErrorResponse> {
    const cache: BusStationResponse = await this.cacheManager.get(
      `bus/stations/${id}/${source ?? 'api'}`,
    );
    if (cache) return cache;
    const isWebSource = source === 'web';
    const url = isWebSource
      ? busWebURL + id
      : `${busApiURL + id}.json?srsname=wgs84`;

    const backup = await this.getStationById(id);

    try {
      // pasobus serves iso-8859-1; axios would decode it as utf-8 and turn
      // every accented character into U+FFFD.
      const data = await fetchWithTimeout<any>(
        this.httpService,
        url,
        isWebSource ? { responseEncoding: 'latin1' } : undefined,
      );

      try {
        const resp: BusStationResponse = {
          id: id,
          street: null,
          lines: [],
          times: [],
          coordinates: [],
          source: null,
          sourceUrl: null,
          type: 'bus',
        };

        if (backup) {
          resp.street = backup.street;
          resp.lines = backup.lines;
          resp.coordinates = backup.coordinates;
        }

        if (!source || source === 'api') {
          resp.source = 'api';
          resp.sourceUrl = url;
          resp.lastUpdated = data.lastUpdated;
          if (!backup) {
            resp.street = capitalizeEachWord(
              fixWords(data.title.split(')')[1].slice(1).split('Lí')[0].trim()),
            );
            resp.coordinates = data.geometry.coordinates;
          }
          const times = [];
          data.destinos.map((destination) => {
            ['primero', 'segundo'].map((element) => {
              const destinationRaw = destination.destino
                .replace(/(^,)|(,$)/g, '')
                .replace(/(^\.)|(\.$)/g, '');
              const destinationFixed = destinationRaw
                .split(' - ')
                .map((item) => capitalizeEachWord(fixWords(item.trim())))
                .join(' - ');
              const transport = {
                line: normalizeLineId(destination.linea),
                destination: destinationFixed,
                time: null,
              };
              if (destination[element].includes('minutos')) {
                transport.time = `${destination[element]
                  .replace(' minutos', '')
                  .replace(/(^\.)|(\.$)/g, '')} min.`;
              } else {
                transport.time = capitalize(
                  fixWords(destination[element].replace(/(^\.)|(\.$)/g, '')),
                );
              }
              times.push(transport);
            });
          });
          resp.times = [...times];
        } else if (source === 'web') {
          const $ = cheerio.load(data);
          const rows = $('table').eq(1).find('tr');

          rows.each((_, row) => {
            const cells = $(row).find('td.digital');
            if (cells.length >= 3) {
              const line = normalizeLineId($(cells[0]).text().trim());
              const destinationRaw = $(cells[1]).text().trim();
              const destination = destinationRaw
                .split(' - ')
                .map((item) => capitalizeEachWord(fixWords(item.trim())))
                .join(' - ');
              let time = $(cells[2])
                .text()
                .trim()
                .replace(/(^,)|(,$)/g, '')
                .replace(/(^\.)|(\.$)/g, '');
              if (time.includes('minutos')) {
                time = `${time
                  .replace(' minutos', '')
                  .replace(/(^\.)|(\.$)/g, '')} min.`;
              } else {
                time = capitalize(fixWords(time).replace(/(^\.)|(\.$)/g, ''));
              }

              if (line) {
                resp.times.push({ line, destination, time });
              }
            }
          });

          resp.source = 'web';
          resp.sourceUrl = url;
          resp.lastUpdated = new Date().toISOString();
        } else if (source === 'backup') {
          return {
            ...backup,
            source: 'backup',
            alerts: await this.alertsForStation(id, backup.lines),
          };
        } else {
          throw new NotFoundException(
            {
              statusCode: HttpStatus.NOT_FOUND,
              message: `Resource with ID '${id}' was not found`,
            },
            `Resource with ID '${id}' was not found`,
          );
        }
        resp.times.forEach((time) => {
          if (!resp.lines.includes(time.line)) {
            resp.lines.push(time.line);
          }
        });
        resp.lines.sort(compareLineIds);
        resp.times.sort((a, b) => {
          const normalize = (time: string) => time.trim().toLowerCase();
          const getWeight = (time: string): number => {
            if (time.includes('parada')) return 0;
            if (time.match(/^\d+/)) return parseInt(time);
            if (time.includes('estimación')) return 9999;
            return 999;
          };
          return getWeight(normalize(a.time)) - getWeight(normalize(b.time));
        });

        resp.alerts = await this.alertsForStation(id, resp.lines);

        await this.cacheManager.set(
          `bus/stations/${id}/${source ?? 'api'}`,
          resp,
          10000,
        );

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
    } catch (exception) {
      if (exception instanceof HttpException) throw exception;
      if (exception.response?.status === HttpStatus.NOT_FOUND) {
        throw new NotFoundException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Resource with ID '${id}' was not found`,
          },
          `Resource with ID '${id}' was not found`,
        );
      } else {
        throw new InternalServerErrorException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: exception.response?.data?.mensaje || exception.message,
          },
          exception.response?.data?.mensaje || exception.message,
        );
      }
    }
  }

  // Lines
  public async getLines(): Promise<BusLinesResponse> {
    return this.cacheManager.wrap('bus/lines', async () =>
      this.toLinesResponse(await this.getAllLines()),
    );
  }

  // Line
  public async getLine(id: string): Promise<BusLineResponse> {
    return this.cacheManager.wrap(`bus/lines/${id}`, async () => {
      const line = await this.getLineById(id);
      if (!line) {
        throw new NotFoundException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Resource with ID '${id}' was not found`,
          },
          `Resource with ID '${id}' was not found`,
        );
      }
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
  public async getAlerts(): Promise<BusAlertResponse[]> {
    const stored = await this.cacheManager.wrap('bus/alerts', () =>
      this.getAllAlerts(),
    );
    return activeAlerts(stored).map(toAlertResponse);
  }

  /**
   * The alerts a stop should show.
   *
   * A notice is narrowed to particular stops only where reading its article
   * established that the alteration stops there — some stops suppressed or
   * moved, the rest of the route running as usual. Everything else stays a
   * line-wide notice on every stop of every line it names, which is where an
   * unread article, a diversion and a doubt all land: over-showing beats
   * leaving somebody at a cut stop with nothing on screen.
   *
   * `direct` marks the stops the notice itself names, so a client can lead
   * with those and fold the rest away.
   */
  private async alertsForStation(
    id: string,
    lines: string[] = [],
  ): Promise<BusAlertResponse[]> {
    const alerts = await this.getAlerts();
    return alerts.flatMap((alert) => {
      const direct = alert.stations.includes(id);
      const onTheLine =
        alert.scope !== 'stations' &&
        alert.lines.some((line) => lines.includes(line));
      return direct || onTheLine ? [{ ...alert, direct }] : [];
    });
  }

  /**
   * Rebuilds every line and stop from the route files avanzagrupo publishes.
   * The whole update is worked out before anything is written, and then goes
   * out as one bulk write per collection, so a run cannot leave stops pointing
   * at lines it never got to update. Nothing a single line does can fail the
   * run: a route that cannot be read leaves that line exactly as it was, and a
   * line the source stopped offering is hidden rather than deleted.
   */
  public async getLinesUpdate(): Promise<BusLinesResponse> {
    const [storedLines, storedStations, published] = await Promise.all([
      this.getAllLines(),
      this.getAllStations(),
      this.fetchZaragozaLines(),
    ]);
    const linesBackup = new Map(storedLines.map((line) => [line.id, line]));
    const stationsBackup = new Map(
      storedStations.map((station) => [station.id, station]),
    );

    // `hidden` was stored until it started carrying two facts at once. Clearing
    // it here rather than per line write reaches the ones no run rewrites.
    await this.busLineModel.updateMany(
      { hidden: { $exists: true } },
      { $unset: { hidden: '' } },
    );

    const activeLines = this.activeLines(published.lines);
    const routes = await this.fetchRoutes(
      [...activeLines.keys()],
      published.routeFiles,
    );

    const stationOps = this.stationUpdates(routes, stationsBackup, activeLines);
    const lineOps = this.lineUpdates(routes, linesBackup, activeLines);
    if (stationOps.length) {
      await this.busStationModel.bulkWrite(stationOps, { ordered: false });
    }
    if (lineOps.length) {
      await this.busLineModel.bulkWrite(lineOps, { ordered: false });
    }
    this.logger.log(
      `Updated ${lineOps.length} lines and ${stationOps.length} stops`,
    );

    await this.syncAlerts(routes);

    await this.cacheManager.clear();
    return this.getLines();
  }

  // The lines the source currently offers, mapped to the label it published
  // for each (the extras are not listed, so they have none).
  private activeLines(lines: ValueLabel[]): ActiveLines {
    if (!lines.length) {
      // Every stored line would look withdrawn if the dropdown stopped
      // parsing, so leave the database as it is instead.
      this.unavailable('Zaragoza published no bus lines to update from');
    }
    return new Map([
      ...extraLineIds.map((id) => [id, undefined] as const),
      ...lines.map((line) => [line.value, line.label] as const),
    ]);
  }

  private async fetchRoutes(
    ids: string[],
    routeFiles: Map<string, string[]>,
  ): Promise<Map<string, FetchedRoute>> {
    const routes = new Map(
      await mapWithLimit(
        ids,
        maxConcurrentLines,
        async (lineId) =>
          [
            lineId,
            await this.fetchLineStations(lineId, routeFiles.get(lineId)),
          ] as const,
      ),
    );

    const unreadable = ids.filter((lineId) => !routes.get(lineId));
    if (unreadable.length === ids.length) {
      this.unavailable('No bus line route could be read from avanzagrupo.com');
    }
    if (unreadable.length) {
      this.logger.warn(
        `Could not read the route of ${this.lineList(unreadable)}; leaving those lines as they are`,
      );
    }
    return routes;
  }

  private async fetchLineStations(
    id: string,
    published: string[] = [],
  ): Promise<FetchedRoute> {
    try {
      // Read both what the site links and what the convention predicts: a page
      // that links one direction must not cost us the other, and a file that is
      // not there costs nothing to ask for.
      const urls = [...new Set([...published, ...KmlForLine(id)])];
      const documents = await Promise.all(
        urls.map(async (url) => ({
          url,
          document: await this.fetchKmlDocument(url),
        })),
      );
      // Without every file the site is willing to serve, this line's stops
      // would look like they had been withdrawn.
      if (documents.some(({ document }) => document.status === 'failed')) {
        return null;
      }

      // Which way round a file is, from the name the site gives it: `-2` is the
      // return leg and everything else is the outbound one. A link the page
      // published itself need not follow the convention, and an unrecognised
      // file is better read as the way out — one long list is what this did
      // before, and is wrong in a way somebody can see rather than a return
      // leg quietly presented as an outbound one.
      const filesOf = (wanted: 'out' | 'back') =>
        documents
          .filter(
            ({ url }) => (/-2\.kml$/i.test(url) ? 'back' : 'out') === wanted,
          )
          .flatMap(({ document }) =>
            document.status === 'read' ? [document.xml] : [],
          );

      const out = filesOf('out');
      const back = filesOf('back');

      return {
        out: out.flatMap(parseKmlStations),
        back: back.flatMap(parseKmlStations),
        // The first file that draws anything, rather than every one of them
        // joined: a leg is one shape, and two files for the same direction are
        // the published link and the guessed one naming the same route.
        pathOut: out.map(parseKmlPath).find((path) => path.length) ?? [],
        pathBack: back.map(parseKmlPath).find((path) => path.length) ?? [],
      };
    } catch (exception) {
      this.logger.warn(
        `Could not read the route of line ${id}: ${exception.message}`,
      );
      return null;
    }
  }

  private async fetchKmlDocument(url: string): Promise<KmlDocument> {
    try {
      const xml = await fetchWithTimeout<string>(this.httpService, url);
      return { status: 'read', xml };
    } catch (exception) {
      if (exception.response?.status === HttpStatus.NOT_FOUND) {
        return { status: 'missing' };
      }
      this.logger.warn(`Could not read ${url}: ${exception.message}`);
      return { status: 'failed' };
    }
  }

  private stationUpdates(
    routes: Map<string, FetchedRoute>,
    stationsBackup: Map<string, BusStation>,
    activeLines: ActiveLines,
  ) {
    // One pass records both a stop's name variants and the lines that reach
    // it. A stop is named slightly differently in every line's KML, so all of
    // its variants are collected before writing instead of letting whichever
    // line finishes last decide the stored name.
    const seen = new Map<
      string,
      { variants: StationBase[]; lines: string[] }
    >();
    routes.forEach((route, lineId) =>
      // Both ways: a stop served only on the return leg is still a stop, and
      // leaving it out here would leave it without the line in its own record.
      allStops(route).forEach((station) => {
        const entry = seen.get(station.id) ?? { variants: [], lines: [] };
        entry.variants.push(station);
        if (!entry.lines.includes(lineId)) entry.lines.push(lineId);
        seen.set(station.id, entry);
      }),
    );

    const stationIds = new Set([...seen.keys(), ...stationsBackup.keys()]);
    return [...stationIds].flatMap((stationId) => {
      const backup = stationsBackup.get(stationId);
      const entry = seen.get(stationId);
      const lines = [
        ...new Set([...(backup?.lines ?? []), ...(entry?.lines ?? [])]),
      ]
        .filter((lineId) => activeLines.has(lineId))
        .sort(compareLineIds);

      // A stop missing from every route read this run may still be served, so
      // only the lines it lists are refreshed.
      if (!entry) {
        return sameList(backup?.lines ?? [], lines)
          ? []
          : [upsertById<BusStation>(stationId, { lines })];
      }

      const normalized = entry.variants.map((variant) =>
        normalizeStreet(variant.street),
      );
      const street = pickCanonicalStreet(normalized);
      const chosen =
        entry.variants[normalized.indexOf(street)] ?? entry.variants[0];

      const unchanged =
        backup?.street === street &&
        sameList(backup.coordinates ?? [], chosen.coordinates) &&
        sameList(backup.lines ?? [], lines);
      return unchanged
        ? []
        : [
            upsertById<BusStation>(stationId, {
              id: stationId,
              street,
              coordinates: chosen.coordinates,
              lines,
              times: [],
              source: 'backup',
              sourceUrl: null,
              lastUpdated: null,
              type: 'bus',
            }),
          ];
    });
  }

  private lineUpdates(
    routes: Map<string, FetchedRoute>,
    linesBackup: Map<string, BusLine>,
    activeLines: ActiveLines,
  ) {
    const updates = [...activeLines].flatMap(([lineId, label]) => {
      const route = routes.get(lineId);
      // Its route could not be read, so there is nothing new to say about it.
      if (!route) return [];
      const backup = linesBackup.get(lineId);
      const stations = route.out.length
        ? route.out.map((station) => station.id)
        : (backup?.stations ?? []);
      // Kept from the backup only when the outbound leg was kept too: a line
      // that has just been read has been read whole, and half a fresh route
      // beside half a stale one is a line that runs somewhere it does not.
      const stationsReturn = route.out.length
        ? route.back.map((station) => station.id)
        : (backup?.stationsReturn ?? []);
      // On the same terms as the stops, and for the same reason: a shape from
      // this read beside stops from the last one is a line drawn somewhere it
      // does not go. An empty path is a file that carried no `LineString`,
      // which is not a reason to drop the one already stored.
      const path = route.pathOut.length ? route.pathOut : (backup?.path ?? []);
      const pathReturn = route.pathOut.length
        ? route.pathBack
        : (backup?.pathReturn ?? []);
      return [
        upsertById<BusLine>(lineId, {
          id: lineId,
          name:
            canonicalLineName(lineId) ??
            capitalizeEachWord(
              fixWords(label ?? linesBackup.get(lineId)?.name ?? lineId),
            ),
          lastUpdated: new Date().toISOString(),
          stations,
          stationsReturn,
          path,
          pathReturn,
          // The source offers it, so whatever it was before, it is not
          // withdrawn now. Whether it has a route to draw is derived from
          // `stations` when the line is read back.
          withdrawn: false,
        }),
      ];
    });

    // A line the source stopped offering has been withdrawn from the network.
    // It is hidden rather than deleted, so it keeps its stops if it returns.
    const retired = [...linesBackup.keys()].filter(
      (lineId) => !activeLines.has(lineId),
    );
    if (retired.length) {
      this.logger.log(
        `Withdrew ${this.lineList(retired)}; avanzagrupo.com no longer lists them`,
      );
    }

    return [
      ...updates,
      ...retired
        .filter((lineId) => !linesBackup.get(lineId).withdrawn)
        .map((lineId) => upsertById<BusLine>(lineId, { withdrawn: true })),
    ];
  }

  /**
   * Stores the alterations the site is publishing.
   *
   * An alert is an extra on top of the lines, so nothing it does can fail the
   * run: a listing that cannot be read or parsed leaves the stored alerts
   * alone, and they age out on their own from the day they were announced.
   * Alerts are never deleted — one whose lines came back empty still has a
   * headline and a link for the list.
   */
  private async syncAlerts(routes: Map<string, FetchedRoute>): Promise<void> {
    try {
      const scraped = await this.fetchAlerts();
      if (!scraped.length) {
        this.logger.warn('Zaragoza published no service alerts to read');
        return;
      }

      const stored = new Map(
        (await this.getAllAlerts()).map((alert) => [alert.id, alert]),
      );
      const readings = await this.readArticles(scraped, stored, routes);
      const now = new Date().toISOString();

      await this.busAlertModel.bulkWrite(
        scraped.map((alert) => {
          const previous = stored.get(alert.id);
          return upsertById<BusAlert>(alert.id, {
            ...alert,
            // This run's reading where it made one, and otherwise the one the
            // alert already carried.
            ...(readings.get(alert.id) ?? readingOf(previous)),
            firstSeen: previous?.firstSeen ?? now,
          });
        }),
        { ordered: false },
      );

      // What the site has stopped showing is over, and nothing else says so:
      // these notices carry no end date and the ones that do are the minority.
      // Dropping them here is what lets the responses stop guessing from a
      // date. Only ever reached with a listing that answered — an endpoint
      // that failed returns nothing at all and leaves the run before this.
      const listed = new Set(scraped.map((alert) => alert.id));
      const gone = [...stored.keys()].filter((id) => !listed.has(id));
      if (gone.length) {
        await this.busAlertModel.deleteMany({ id: { $in: gone } });
      }

      this.logger.log(
        `Read ${scraped.length} service alerts, dropped ${gone.length}`,
      );
    } catch (exception) {
      this.logger.warn(
        `Could not update the service alerts: ${exception.message}`,
      );
    }
  }

  /**
   * Reads the article behind each alert whose text has changed.
   *
   * The listing gives a headline and a line list; when an alteration ends and
   * which stops it names are written in the prose of the article, differently
   * by every author. A model reads that, and only for an article whose text is
   * not the one already read — the same words cannot yield different dates.
   *
   * Nothing here can fail the run: with no model configured, or an article
   * that will not load, or a reading that fails its checks, the alert keeps
   * exactly what its listing said.
   */
  private async readArticles(
    scraped: ScrapedAlert[],
    stored: Map<string, BusAlert>,
    routes: Map<string, FetchedRoute>,
  ): Promise<ArticleReadings> {
    const readings: ArticleReadings = new Map();
    if (!this.alertReader.enabled) return readings;

    // Most mornings this is empty: the alerts on the listing are the ones read
    // yesterday, and an alert whose end date is known is not fetched at all.
    const unsettled = scraped.filter((alert) => !settled(stored.get(alert.id)));
    if (!unsettled.length) return readings;

    const articles = await mapWithLimit(
      unsettled,
      maxConcurrentArticles,
      async (alert) => ({
        alert,
        article: await this.fetchArticle(alert.url),
      }),
    );
    // An article whose text is the one already read says nothing new; one that
    // could not be fetched says nothing at all. Both leave the stored reading
    // exactly where it is.
    const pending = articles
      .filter(
        ({ alert, article }) =>
          article && articleHash(article) !== stored.get(alert.id)?.articleHash,
      )
      .slice(0, maxAnalyzedAlerts);
    if (!pending.length) return readings;

    // The readings are independent of each other, and the model is not the
    // WordPress site: they go out together.
    await mapWithLimit(
      pending,
      maxConcurrentArticles,
      async ({ alert, article }) => {
        // What the article's words are resolved against: the stops of each line
        // it affects, in the order the route runs them, so that "entre Gran Vía
        // y Plaza España" can become the stops it actually means.
        const details = await this.alertReader.read(
          alert,
          article,
          routesOf(alert.lines, routes),
        );
        // Words nobody has read cannot hold a notice to a few stops, so an
        // article that changed and could not be read clears what the last one
        // said — its hash included, so the next run tries again.
        readings.set(
          alert.id,
          details
            ? { ...details, articleHash: articleHash(article) }
            : readingOf(),
        );
      },
    );
    const read = [...readings.values()].filter(
      (reading) => reading.articleHash,
    ).length;
    this.logger.log(`Read the article of ${read} service alerts`);
    return readings;
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

  /**
   * The alterations the site is currently showing.
   *
   * Not the category archive, which keeps every notice ever published: the
   * endpoint the line pages themselves call, whose answer is what a traveller
   * is shown today. Asked once for every line at a time — `default` — because
   * asking it line by line returns the same notices carrying the same line
   * lists, forty-six times over.
   */
  private async fetchAlerts(): Promise<ScrapedAlert[]> {
    try {
      const page = await fetchWithTimeout<string>(
        this.httpService,
        busLinesURL,
      );
      // Minted per page load, and the endpoint answers 403 without it.
      const nonce = parseAlertsNonce(page);
      if (!nonce) {
        this.logger.warn(`No alterations nonce on ${busLinesURL}`);
        return [];
      }

      const alerts = new Map<string, ScrapedAlert>();
      for (let paged = 1; paged <= maxAlertPages; paged++) {
        const fragment = await postWithTimeout<string>(
          this.httpService,
          busAlertsURL,
          {
            action: 'get_alteraciones_servicio',
            lineaAfectada: 'default',
            nonce,
            paged: `${paged}`,
          },
        );
        const listed = parseAlterations(fragment, busLinesURL);
        // A page with nothing new on it ends the walk, whether the paginator
        // ran out or started handing back the page before it.
        if (!listed.some((alert) => !alerts.has(alert.id))) break;
        listed.forEach((alert) => alerts.set(alert.id, alert));
      }
      return [...alerts.values()];
    } catch (exception) {
      // Whatever the page that is fetched for the lines carried is still
      // worth storing, so a listing that is down costs only its own alerts.
      this.logger.warn(
        `Could not read the service alerts: ${exception.message}`,
      );
      return [];
    }
  }

  async fetchZaragozaLines(): Promise<PublishedLines> {
    try {
      const html = await fetchWithTimeout<string>(
        this.httpService,
        busLinesURL,
      );

      const $ = cheerio.load(html);

      return {
        lines: $('select#linea-lineas-horarios option')
          .toArray()
          .map((el) => ({
            value: $(el).attr('value'),
            label: $(el).text().split(' – ').slice(1).join(' - ').trim(),
          }))
          .filter((line) => line.value && line.value !== 'lineDefault'),
        routeFiles: kmlLinksByLine(html),
      };
    } catch (exception) {
      if (exception instanceof HttpException) throw exception;
      this.logger.error(
        `Failed to fetch or parse the Zaragoza line list: ${exception.message}`,
      );
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
        },
        exception.message,
      );
    }
  }

  private unavailable(message: string): never {
    throw new ServiceUnavailableException(
      { statusCode: HttpStatus.SERVICE_UNAVAILABLE, message },
      message,
    );
  }

  private lineList = (ids: string[]) =>
    [...ids].sort(compareLineIds).join(', ');

  /**
   * Numbered lines first, then the lettered ones, then the night lines. Keys
   * that look like integers are enumerated first and in ascending order
   * whatever the insertion order — the same thing compareLineIds asks for, so
   * the two agree and the order survives a JSON round trip.
   */
  private toLinesResponse(lines: BusLine[]): BusLinesResponse {
    return Object.fromEntries(
      [...lines]
        .sort((a, b) => compareLineIds(a.id, b.id))
        .map((line) => [line.id, toLineResponse(line)]),
    );
  }

  async getAllStations() {
    return this.busStationModel.find().sort({ id: 1 }).lean().exec();
  }

  async getAllLines() {
    return this.busLineModel.find().sort({ id: 1 }).lean().exec();
  }

  async getAllAlerts() {
    return this.busAlertModel.find().sort({ id: 1 }).lean().exec();
  }

  async getStationById(id: string) {
    return this.busStationModel.findOne({ id }).lean();
  }

  async getLineById(id: string) {
    return this.busLineModel.findOne({ id }).lean();
  }
}
