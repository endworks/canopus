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
import { AnyBulkWriteOperation, Model } from 'mongoose';

import {
  BusLineResponse,
  BusLinesResponse,
  BusStationResponse,
  BusStationsResponse,
} from '../models/bus.interface';
import { ErrorResponse, mapWithLimit } from '@canopus/shared';
import { fetchWithTimeout } from '@canopus/nest';
import { StationBase, ValueLabel } from '../models/common.interface';
import {
  BusLine,
  BusLineDocument,
  BusStation,
  BusStationDocument,
} from '../schemas/bus.schema';
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

const requestTimeout = 10000;
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
type LineRoute = StationBase[] | null;

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

const toLineResponse = ({
  _id,
  ...line
}: BusLine & { _id?: unknown }): BusLineResponse => ({
  ...line,
  // Out of listings either because the source withdrew the line or because
  // there is no route to draw for it.
  hidden: !!line.withdrawn || !line.stations?.length,
});

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const upsertById = <T extends { id: string }>(
  id: string,
  data: Partial<T>,
) => ({
  updateOne: { filter: { id }, update: { $set: data }, upsert: true },
});

// `hidden` was stored until it started carrying two different facts at once;
// drop it from each line as it is rewritten.
const lineUpdate = (id: string, data: Partial<BusLine>) =>
  ({
    updateOne: {
      filter: { id },
      update: { $set: data, $unset: { hidden: '' } },
      upsert: true,
    },
  }) as AnyBulkWriteOperation<BusLineDocument>;

@Injectable()
export class BusService {
  private readonly logger = new Logger(BusService.name);
  // Route files the lines page links, if it links any: filled in per run.
  private publishedRouteFiles = new Map<string, string[]>();

  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(BusStation.name)
    private busStationModel: Model<BusStationDocument>,
    @InjectModel(BusLine.name)
    private busLineModel: Model<BusLineDocument>,
    private httpService: HttpService,
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
          return { ...backup, source: 'backup' };
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

  /**
   * Rebuilds every line and stop from the route files avanzagrupo publishes.
   * The whole update is worked out before anything is written, and then goes
   * out as one bulk write per collection, so a run cannot leave stops pointing
   * at lines it never got to update. Nothing a single line does can fail the
   * run: a route that cannot be read leaves that line exactly as it was, and a
   * line the source stopped offering is hidden rather than deleted.
   */
  public async getLinesUpdate(): Promise<BusLinesResponse> {
    const [storedLines, storedStations] = await Promise.all([
      this.getAllLines(),
      this.getAllStations(),
    ]);
    const linesBackup = new Map(storedLines.map((line) => [line.id, line]));
    const stationsBackup = new Map(
      storedStations.map((station) => [station.id, station]),
    );

    const activeLines = await this.fetchActiveLines();
    const routes = await this.fetchRoutes([...activeLines.keys()]);

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

    await this.cacheManager.clear();
    return this.getLines();
  }

  // The lines the source currently offers, mapped to the label it published
  // for each (the extras are not listed, so they have none).
  private async fetchActiveLines(): Promise<Map<string, string | undefined>> {
    const { lines, routeFiles } = await this.fetchZaragozaLines();
    this.publishedRouteFiles = routeFiles;
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

  private async fetchRoutes(ids: string[]): Promise<Map<string, LineRoute>> {
    const routes = new Map<string, LineRoute>();
    await mapWithLimit(ids, maxConcurrentLines, async (lineId) => {
      routes.set(lineId, await this.fetchLineStations(lineId));
    });

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

  private async fetchLineStations(id: string): Promise<LineRoute> {
    try {
      // A link the site publishes beats a URL guessed from the convention.
      const urls = this.publishedRouteFiles.get(id) ?? KmlForLine(id);
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
      const xml = await fetchWithTimeout<string>(this.httpService, url, {
        timeoutMs: requestTimeout,
      });
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
    routes: Map<string, LineRoute>,
    stationsBackup: Map<string, BusStation>,
    activeLines: Map<string, string | undefined>,
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

      const street = pickCanonicalStreet(
        entry.variants.map((variant) => variant.street),
      );
      const chosen =
        entry.variants.find(
          (variant) => normalizeStreet(variant.street) === street,
        ) ?? entry.variants[0];

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
    routes: Map<string, LineRoute>,
    linesBackup: Map<string, BusLine>,
    activeLines: Map<string, string | undefined>,
  ) {
    const updates = [...activeLines].flatMap(([lineId, label]) => {
      const route = routes.get(lineId);
      // Its route could not be read, so there is nothing new to say about it.
      if (!route) return [];
      const stations = route.length
        ? route.map((station) => station.id)
        : (linesBackup.get(lineId)?.stations ?? []);
      return [
        lineUpdate(lineId, {
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
        .map((lineId) => lineUpdate(lineId, { withdrawn: true })),
    ];
  }

  async fetchZaragozaLines(): Promise<PublishedLines> {
    try {
      const html = await fetchWithTimeout<string>(
        this.httpService,
        busLinesURL,
        { timeoutMs: requestTimeout },
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

  async getStationById(id: string) {
    return this.busStationModel.findOne({ id }).lean();
  }

  async getLineById(id: string) {
    return this.busLineModel.findOne({ id }).lean();
  }

  async saveStation(data: Partial<BusStation>) {
    return this.busStationModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { returnDocument: 'after', upsert: true },
      )
      .lean();
  }

  async saveLine(data: Partial<BusLine>) {
    return this.busLineModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { returnDocument: 'after', upsert: true },
      )
      .lean();
  }
}
