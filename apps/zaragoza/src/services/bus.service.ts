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
import { fetchWithTimeout } from '@canopus/nest';
import { StationBase, ValueLabel } from '../models/common.interface';
import {
  BusAlert,
  BusAlertDocument,
  BusLine,
  BusLineDocument,
  BusStation,
  BusStationDocument,
} from '../schemas/bus.schema';
import { articleText, parseAlerts, ScrapedAlert } from '../alerts';
import { AlertDetails, AlertReader, LineRoute } from '../alert-reader';
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
const busAlertsURL =
  'https://zaragoza.avanzagrupo.com/category/alteraciones-del-servicio/';

/**
 * How long an alteration stays in the responses.
 *
 * The site says when an alteration was announced and never when it is over,
 * and the listing shows only the latest few, so an alert that has scrolled off
 * it is not thereby finished. A week is long enough for a weekend of works and
 * short enough that August's fiestas are not still on a stop in September.
 */
const alertMaxAgeDays = 7;

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

// The stops of a line, or null when its route could not be read at all.
type FetchedRoute = StationBase[] | null;

type ActiveLines = Map<string, string | undefined>;

// What one read of the lines page yields.
interface PublishedLines {
  lines: ValueLabel[];
  routeFiles: Map<string, string[]>;
}

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
const toLineResponse = ({
  _id,
  withdrawn,
  ...line
}: BusLine & { _id?: unknown }): BusLineResponse => ({
  ...line,
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
  scope: alert.scope ?? 'line',
});

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/**
 * The alterations still in force, newest first.
 *
 * An alert whose article gave an end date is shown until that day and not one
 * after it. Everything else is aged by the day it was announced — or, when
 * even that could not be read, by the run that first saw it — because the
 * listing itself never says when an alteration is over.
 */
const activeAlerts = (alerts: BusAlert[]): BusAlert[] => {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = daysAgo(alertMaxAgeDays).slice(0, 10);
  const announced = (alert: BusAlert) =>
    (alert.date ?? alert.firstSeen ?? '').slice(0, 10);
  return alerts
    .filter((alert) =>
      alert.endDate ? alert.endDate >= today : announced(alert) >= cutoff,
    )
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
    const stops = (routes.get(line) ?? [])
      .filter((stop) => !seen.has(stop.id) && seen.add(stop.id))
      .map(({ id, street }) => ({ id, street }));
    return stops.length ? [{ line, stations: stops }] : [];
  });

const articleHash = (article: string) =>
  createHash('sha256').update(article).digest('hex');

/** What a stored alert says its article was read to mean. */
const storedReading = (alert?: BusAlert): AlertAnalysis | undefined =>
  alert?.articleHash
    ? {
        startDate: alert.startDate,
        endDate: alert.endDate,
        stations: alert.stations ?? [],
        scope: alert.scope ?? 'line',
        articleHash: alert.articleHash,
        analyzedAt: alert.analyzedAt,
      }
    : undefined;

/** One reading of an article, with what identifies the text it read. */
type AlertAnalysis = AlertDetails & { articleHash: string; analyzedAt: string };

/**
 * What a run knows about each alert's article: a fresh reading, an entry that
 * is `null` where the text changed and nobody could read it, and no entry at
 * all where the text has not changed since the stored reading was taken.
 */
type ArticleReadings = Map<string, AlertAnalysis | null>;

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
      return toLineResponse(line);
    });
  }

  // Alerts
  public async getAlerts(): Promise<BusAlertResponse[]> {
    return this.cacheManager.wrap('bus/alerts', async () =>
      activeAlerts(await this.getAllAlerts()).map(toAlertResponse),
    );
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
        urls.map((url) => this.fetchKmlDocument(url)),
      );
      // Without every file the site is willing to serve, this line's stops
      // would look like they had been withdrawn.
      if (documents.some((document) => document.status === 'failed')) {
        return null;
      }
      return documents.flatMap((document) =>
        document.status === 'read' ? parseKmlStations(document.xml) : [],
      );
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
    routes.forEach((stations, lineId) =>
      (stations ?? []).forEach((station) => {
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
      const stations = route.length
        ? route.map((station) => station.id)
        : (linesBackup.get(lineId)?.stations ?? []);
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
          // What the article is known to say: this run's reading, or the
          // stored one where the text has not changed since it was taken, or
          // nothing at all — an edit nobody has read, a call that failed, no
          // key. With nothing behind it the notice is the whole line's again,
          // which is where it started and the side of the judgement that does
          // not leave a stop silent.
          const reading = readings.has(alert.id)
            ? readings.get(alert.id)
            : storedReading(previous);
          return upsertById<BusAlert>(alert.id, {
            ...alert,
            startDate: reading?.startDate ?? null,
            endDate: reading?.endDate ?? null,
            stations: reading?.stations ?? [],
            scope: reading?.scope ?? 'line',
            // Kept even where the reading is not, so the next run can tell an
            // article that changed from one nobody has read.
            articleHash: reading?.articleHash ?? previous?.articleHash,
            analyzedAt: reading?.analyzedAt ?? previous?.analyzedAt,
            firstSeen: previous?.firstSeen ?? now,
          });
        }),
        { ordered: false },
      );
      this.logger.log(`Read ${scraped.length} service alerts`);
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
    // Every alert starts out as one no reading stands behind; a hash that
    // still matches, or a reading, takes it out of that state.
    const readings: ArticleReadings = new Map(
      scraped.map((alert) => [alert.id, null]),
    );
    if (!this.alertReader.enabled) return readings;

    const articles = await mapWithLimit(
      scraped,
      maxConcurrentArticles,
      async (alert) => ({
        alert,
        article: await this.fetchArticle(alert.url),
      }),
    );
    articles.forEach(({ alert, article }) => {
      if (
        article &&
        articleHash(article) === stored.get(alert.id)?.articleHash
      ) {
        readings.delete(alert.id);
      }
    });
    const pending = articles
      .filter(({ alert, article }) => article && readings.has(alert.id))
      .slice(0, maxAnalyzedAlerts);
    if (!pending.length) return readings;

    const now = new Date().toISOString();
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
        if (details) {
          readings.set(alert.id, {
            ...details,
            articleHash: articleHash(article),
            analyzedAt: now,
          });
        }
      },
    );
    const read = [...readings.values()].filter(Boolean).length;
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

  private async fetchAlerts(): Promise<ScrapedAlert[]> {
    try {
      const html = await fetchWithTimeout<string>(
        this.httpService,
        busAlertsURL,
      );
      return parseAlerts(html, busAlertsURL);
    } catch (exception) {
      // Whatever the page that is fetched for the lines carried is still
      // worth storing, so a home page that is down costs only its own alerts.
      this.logger.warn(
        `Could not read the service alerts from ${busAlertsURL}: ${exception.message}`,
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
