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
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  BusLineResponse,
  BusLinesResponse,
  BusStationResponse,
  BusStationsResponse,
} from '../models/bus.interface';
import { ErrorResponse } from '@canopus/shared';
import { StationBase, ValueLabel } from '../models/common.interface';
import {
  BusLine,
  BusLineDocument,
  BusStation,
  BusStationDocument,
} from '../schemas/bus.schema';
import {
  canonicalLineNames,
  capitalize,
  capitalizeEachWord,
  compareLineIds,
  extraLineIds,
  fixWords,
  isInt,
  KmlForLine,
  normalizeLineId,
  pickCanonicalStreet,
  restoreAccents,
} from '../utils';

const busApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/poste-autobus/tuzsa-';
const busWebURL =
  'https://zaragoza-pasobus.avanzagrupo.com/frm_esquemaparadatime.php?poste=';

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
      const response = await lastValueFrom(
        this.httpService
          // pasobus serves iso-8859-1; axios would decode it as utf-8 and turn
          // every accented character into U+FFFD.
          .get(url, isWebSource ? { responseEncoding: 'latin1' } : undefined)
          .pipe(timeout(10000)),
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
          resp.lastUpdated = response.data.lastUpdated;
          if (!backup) {
            resp.street = capitalizeEachWord(
              fixWords(
                response.data.title
                  .split(')')[1]
                  .slice(1)
                  .split('Lí')[0]
                  .trim(),
              ),
            );
            resp.coordinates = response.data.geometry.coordinates;
          }
          const times = [];
          response.data.destinos.map((destination) => {
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
          const $ = cheerio.load(response.data);
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
      if (exception instanceof TimeoutError) {
        throw new InternalServerErrorException(
          {
            statusCode: HttpStatus.REQUEST_TIMEOUT,
            message:
              'Request timeout: The API request took too long to complete',
          },
          'Request timeout: The API request took too long to complete',
        );
      }
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
  public async getLines(): Promise<BusLinesResponse | ErrorResponse> {
    try {
      const cache: BusLinesResponse = await this.cacheManager.get(`bus/lines`);
      if (cache) return cache;
      const resp = this.toLinesResponse(await this.getAllLines());
      await this.cacheManager.set(`bus/lines`, resp);
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

  // Line
  public async getLine(id: string): Promise<BusLineResponse | ErrorResponse> {
    try {
      const cache: BusLineResponse = await this.cacheManager.get(
        `bus/lines/${id}`,
      );
      if (cache) return cache;
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
      const { _id, ...lineWithoutId } = line;
      await this.cacheManager.set(`bus/lines/${id}`, lineWithoutId);
      return lineWithoutId;
    } catch (exception) {
      // An unknown line is a 404; only wrap what is not already an HTTP error.
      if (exception instanceof HttpException) throw exception;
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
        },
        exception.message,
      );
    }
  }

  // Rebuilds every line and every stop from the KML avanzagrupo publishes.
  // Nothing here is allowed to fail the whole run: a line whose KML is missing
  // keeps the stops already stored, and a line the source stopped offering is
  // hidden rather than deleted, so it can come back with its data intact.
  public async getLinesUpdate(): Promise<BusLinesResponse | ErrorResponse> {
    try {
      const linesBackup = new Map(
        (await this.getAllLines()).map((line) => [line.id, line]),
      );
      const stationsBackup = new Map(
        (await this.getAllStations()).map((station) => [station.id, station]),
      );

      const availableLines = await this.fetchZaragozaLines(true);
      if (!availableLines.length) {
        // Every stored line would look withdrawn if the dropdown stopped
        // parsing, so leave the database as it is instead.
        throw new ServiceUnavailableException(
          {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            message: 'Zaragoza published no bus lines to update from',
          },
          'Zaragoza published no bus lines to update from',
        );
      }

      const linesToBeUpdated = [
        ...availableLines.map((line) => line.value),
        ...extraLineIds.filter(
          (id) => !availableLines.some((line) => line.value === id),
        ),
      ];
      const activeLines = new Set(linesToBeUpdated);

      const stationsByLine = new Map<string, StationBase[]>();
      await Promise.all(
        linesToBeUpdated.map(async (lineId) => {
          stationsByLine.set(lineId, await this.fetchLineStations(lineId));
        }),
      );

      const linesWithoutStations = linesToBeUpdated.filter(
        (lineId) => !stationsByLine.get(lineId).length,
      );
      if (linesWithoutStations.length === linesToBeUpdated.length) {
        throw new ServiceUnavailableException(
          {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            message: 'No bus line route could be read from avanzagrupo.com',
          },
          'No bus line route could be read from avanzagrupo.com',
        );
      }
      if (linesWithoutStations.length) {
        this.logger.warn(
          `No stops read for ${linesWithoutStations
            .sort(compareLineIds)
            .join(', ')}; keeping the stored ones`,
        );
      }

      // A stop is named slightly differently in every line's KML, so collect
      // all of its variants before writing instead of letting whichever line
      // finishes last decide the stored name.
      const stationVariants = new Map<string, StationBase[]>();
      stationsByLine.forEach((stations) =>
        stations.forEach((station) =>
          stationVariants.set(station.id, [
            ...(stationVariants.get(station.id) ?? []),
            station,
          ]),
        ),
      );

      // A stop missing from every KML this run may still be served, so it is
      // only rewritten when one of the lines it lists no longer exists.
      const stationIds = new Set([
        ...stationVariants.keys(),
        ...stationsBackup.keys(),
      ]);

      await Promise.all(
        [...stationIds].map(async (stationId) => {
          const backup = stationsBackup.get(stationId);
          const variants = stationVariants.get(stationId) ?? [];
          const lines = [
            ...new Set([
              ...(backup?.lines ?? []),
              ...linesToBeUpdated.filter((lineId) =>
                stationsByLine
                  .get(lineId)
                  .some((station) => station.id === stationId),
              ),
            ]),
          ]
            .filter((lineId) => activeLines.has(lineId))
            .sort(compareLineIds);

          if (!variants.length) {
            const stored = backup?.lines ?? [];
            const unchanged =
              stored.length === lines.length &&
              stored.every((lineId, index) => lineId === lines[index]);
            if (unchanged) return;
            await this.saveStation({ id: stationId, lines });
            return;
          }

          const street = pickCanonicalStreet(
            variants.map((variant) => variant.street),
          );
          const chosen =
            variants.find(
              (variant) =>
                restoreAccents(variant.street).replace(/\s+/g, ' ').trim() ===
                street,
            ) ?? variants[0];

          await this.saveStation({
            id: stationId,
            street,
            coordinates: chosen.coordinates,
            lines,
            times: [],
            source: 'backup',
            sourceUrl: null,
            lastUpdated: null,
            type: 'bus',
          });
        }),
      );

      await Promise.all(
        linesToBeUpdated.map(async (lineId) => {
          const fresh = stationsByLine.get(lineId);
          const stations = fresh.length
            ? fresh.map((station) => station.id)
            : (linesBackup.get(lineId)?.stations ?? []);
          const line: BusLineResponse = {
            id: lineId,
            name:
              canonicalLineNames[lineId] ??
              capitalizeEachWord(
                fixWords(
                  availableLines.find((item) => item.value === lineId)?.label ??
                    linesBackup.get(lineId)?.name ??
                    lineId,
                ),
              ),
            lastUpdated: new Date().toISOString(),
            stations,
            // TUR's KML names its placemarks without a "poste N -" prefix, so
            // it yields no stops and has no route to draw. Written on every
            // run: an undefined `hidden` is dropped from the update, which
            // would leave a line hidden forever once it failed once.
            hidden: !stations.length,
          };
          await this.saveLine(line);
        }),
      );

      const retiredLines = [...linesBackup.keys()].filter(
        (lineId) => !activeLines.has(lineId),
      );
      await Promise.all(
        retiredLines.map(async (lineId) => {
          if (linesBackup.get(lineId).hidden) return;
          await this.saveLine({ id: lineId, hidden: true });
        }),
      );
      if (retiredLines.length) {
        this.logger.log(
          `Hid ${retiredLines
            .sort(compareLineIds)
            .join(', ')}; avanzagrupo.com no longer lists them`,
        );
      }

      const resp = this.toLinesResponse(await this.getAllLines());
      await Promise.all([
        this.cacheManager.del('bus/stations'),
        ...[...linesToBeUpdated, ...retiredLines].map((lineId) =>
          this.cacheManager.del(`bus/lines/${lineId}`),
        ),
      ]);
      await this.cacheManager.set('bus/lines', resp);
      return resp;
    } catch (exception) {
      if (exception instanceof HttpException) throw exception;
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
        },
        exception.message,
      );
    }
  }

  async fetchZaragozaLines(refresh = false): Promise<ValueLabel[]> {
    try {
      if (!refresh) {
        const cache: ValueLabel[] =
          await this.cacheManager.get(`bus/lines/available`);
        if (cache) return cache;
      }
      const url = 'https://zaragoza.avanzagrupo.com/lineas-y-horarios/';
      const response = await lastValueFrom(
        this.httpService.get(url).pipe(timeout(10000)),
      );

      const html = await response.data;

      const $ = cheerio.load(html);

      const lines: ValueLabel[] = [];

      $('select#linea-lineas-horarios option').each((_, el) => {
        const value = $(el).attr('value');
        const label = $(el).text().split(' – ').slice(1).join(' - ').trim();

        if (value && value !== 'lineDefault') {
          lines.push({ value, label });
        }
      });

      await this.cacheManager.set(`bus/lines/available`, lines);
      return lines;
    } catch (exception) {
      if (exception instanceof TimeoutError) {
        throw new InternalServerErrorException(
          {
            statusCode: HttpStatus.REQUEST_TIMEOUT,
            message:
              'Request timeout: The API request took too long to complete',
          },
          'Request timeout: The API request took too long to complete',
        );
      }
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

  async fetchZaragozaLineFromKml(
    id: string,
    refresh = false,
  ): Promise<StationBase[]> {
    if (!refresh) {
      const cache: StationBase[] = await this.cacheManager.get(
        `bus/lines/${id}/kml`,
      );
      if (cache) return cache;
    }
    const documents = await Promise.all(
      KmlForLine(id).map((url) => this.fetchKmlDocument(url)),
    );

    const stations: StationBase[] = [];
    documents.forEach((xml) => {
      if (!xml) return;
      const $ = cheerio.load(xml, { xmlMode: true });

      $('Placemark').each((_, el) => {
        const name = $(el).find('name').text().trim();

        const match = name.match(/poste\s*(\d+)\s*-\s*(.+)/i);
        const stationId = match ? match[1] : '';
        const street = match ? match[2].trim() : '';
        const coordsText = $(el).find('coordinates').text().trim();
        const [lonStr, latStr] = coordsText.split(',').map((s) => s.trim());

        if (isInt(stationId)) {
          stations.push({
            id: stationId,
            street,
            coordinates: [lonStr, latStr],
          });
        }
      });
    });

    await this.cacheManager.set(`bus/lines/${id}/kml`, stations);
    return stations;
  }

  // Route files are guessed from the line id, and not every line publishes one
  // per direction (nor keeps the same upload folder when a route is redrawn).
  // A file that is not there is not an error; it just adds no stops.
  private async fetchKmlDocument(url: string): Promise<string | null> {
    try {
      const response = await lastValueFrom(
        this.httpService.get(url).pipe(timeout(10000)),
      );
      return response.data;
    } catch (exception) {
      if (exception.response?.status !== HttpStatus.NOT_FOUND) {
        this.logger.warn(`Could not read ${url}: ${exception.message}`);
      }
      return null;
    }
  }

  // One unreachable line must not abort the update of all the others.
  private async fetchLineStations(id: string): Promise<StationBase[]> {
    try {
      return await this.fetchZaragozaLineFromKml(id, true);
    } catch (exception) {
      this.logger.warn(
        `Could not read the route of line ${id}: ${exception.message}`,
      );
      return [];
    }
  }

  // Numbered lines first, then the lettered ones, then the night lines.
  private toLinesResponse(lines: BusLine[]): BusLinesResponse {
    const resp: BusLinesResponse = {};
    [...lines]
      .sort((a, b) => compareLineIds(a.id, b.id))
      .forEach((line) => {
        const { _id, ...lineWithoutId } = line as BusLine & { _id?: unknown };
        resp[line.id] = lineWithoutId as BusLineResponse;
      });
    return resp;
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
