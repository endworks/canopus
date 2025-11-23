import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cache } from 'cache-manager';
import * as cheerio from 'cheerio';
import { Model } from 'mongoose';
import { lastValueFrom } from 'rxjs';
import {
  BusLineResponse,
  BusLinesResponse,
  BusStationResponse,
  BusStationsResponse
} from '../models/bus.interface';
import {
  ErrorResponse,
  StationBase,
  ValueLabel
} from '../models/common.interface';
import {
  BusLine,
  BusLineDocument,
  BusStation,
  BusStationDocument
} from '../schemas/bus.schema';
import {
  capitalize,
  capitalizeEachWord,
  fixWords,
  isInt,
  KmlForLine
} from '../utils';

const busApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/poste-autobus/tuzsa-';
const busWebURL =
  'https://zaragoza-pasobus.avanzagrupo.com/frm_esquemaparadatime.php?poste=';

@Injectable()
export class BusService {
  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(BusStation.name)
    private busStationModel: Model<BusStationDocument>,
    @InjectModel(BusLine.name)
    private busLineModel: Model<BusLineDocument>,
    private httpService: HttpService
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
        const { _id, ...stationWithoutId } = station;
        resp[station.id] = stationWithoutId;
      });
      await this.cacheManager.set(`bus/stations`, resp);
      return resp;
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message
        },
        exception.message
      );
    }
  }

  // Station
  public async getStation(
    id: string,
    source?: string
  ): Promise<BusStationResponse | ErrorResponse> {
    const cache: BusStationResponse = await this.cacheManager.get(
      `bus/stations/${id}/${source ?? 'api'}`
    );
    if (cache) return cache;
    const url =
      source && source === 'web'
        ? busWebURL + id
        : `${busApiURL + id}.json?srsname=wgs84`;

    const backup = await this.getStationById(id);

    try {
      const response = await lastValueFrom(this.httpService.get(url));

      try {
        const resp: BusStationResponse = {
          id: id,
          street: null,
          lines: [],
          times: [],
          coordinates: [],
          source: null,
          sourceUrl: null,
          type: 'bus'
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
                response.data.title.split(')')[1].slice(1).split('Lí')[0].trim()
              )
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
                line: capitalize(fixWords(destination.linea)),
                destination: destinationFixed,
                time: null
              };
              if (destination[element].includes('minutos')) {
                transport.time = `${destination[element]
                  .replace(' minutos', '')
                  .replace(/(^\.)|(\.$)/g, '')} min.`;
              } else {
                transport.time = capitalize(
                  fixWords(destination[element].replace(/(^\.)|(\.$)/g, ''))
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
              const line = capitalize(fixWords($(cells[0]).text().trim()));
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
              message: `Resource with ID '${id}' was not found`
            },
            `Resource with ID '${id}' was not found`
          );
        }
        resp.times.forEach((time) => {
          if (!resp.lines.includes(time.line)) {
            resp.lines.push(time.line);
          }
        });
        resp.lines.sort();
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
          10000
        );

        return resp;
      } catch (exception) {
        throw new InternalServerErrorException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: exception.message
          },
          exception.message
        );
      }
    } catch (exception) {
      if (exception.response.status === HttpStatus.NOT_FOUND) {
        throw new NotFoundException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Resource with ID '${id}' was not found`
          },
          `Resource with ID '${id}' was not found`
        );
      } else {
        throw new InternalServerErrorException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: exception.response.data?.mensaje || exception.message
          },
          exception.response.data?.mensaje || exception.message
        );
      }
    }
  }

  // Lines
  public async getLines(): Promise<BusLinesResponse | ErrorResponse> {
    try {
      const cache: BusLinesResponse = await this.cacheManager.get(`bus/lines`);
      if (cache) return cache;
      const resp: BusLinesResponse = {};
      const lines = await this.getAllLines();
      lines.forEach((line) => {
        const { _id, ...lineWithoutId } = line;
        resp[line.id] = lineWithoutId;
      });
      await this.cacheManager.set(`bus/lines`, resp);
      return resp;
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message
        },
        exception.message
      );
    }
  }

  // Line
  public async getLine(id: string): Promise<BusLineResponse | ErrorResponse> {
    try {
      const cache: BusLineResponse = await this.cacheManager.get(
        `bus/lines/${id}`
      );
      if (cache) return cache;
      const line = await this.getLineById(id);
      if (!line) {
        throw new NotFoundException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Resource with ID '${id}' was not found`
          },
          `Resource with ID '${id}' was not found`
        );
      }
      const { _id, ...lineWithoutId } = line;
      await this.cacheManager.set(`bus/lines/${id}`, lineWithoutId);
      return lineWithoutId;
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message
        },
        exception.message
      );
    }
  }

  public async getLinesUpdate(): Promise<BusLinesResponse | ErrorResponse> {
    try {
      const backup = await this.getAllLines();
      const stationsBackup = await this.getAllStations();

      const webLines = await this.fetchZaragozaLinesFromWeb();
      const availableLines = await this.fetchZaragozaLines();
      const linesToBeUpdated = availableLines.map((line) => line.value);
      await Promise.all(
        linesToBeUpdated.map(async (lineId) => {
          const lineStations = await this.fetchZaragozaLineFromKml(lineId);
          const stations = lineStations.map((station) => station.id);
          const stationsToUpdate = {};
          lineStations.forEach(async (station) => {
            const lines = stationsBackup[station.id]?.lines ?? [lineId];
            if (!lines.includes(lineId)) {
              lines.push(lineId);
            }
            stationsToUpdate[station.id] = {
              ...(stationsBackup[station.id] ?? { lines }),
              id: station.id,
              street: station.street,
              coordinates: station.coordinates,
              lines,
              times: [],
              source: 'backup',
              sourceUrl: null,
              lastUpdated: null,
              type: 'bus'
            };
            await this.saveStation(stationsToUpdate[station.id]);
          });
          const hidden = !stations.length ? true : undefined;
          const line: BusLineResponse = {
            id: lineId,
            name: capitalizeEachWord(
              fixWords(
                webLines.find((item) => item.value === lineId)?.label ??
                  backup[lineId]?.name ??
                  lineId
              )
            ),
            lastUpdated: new Date().toISOString(),
            stations,
            hidden
          };
          await this.saveLine(line);
        })
      );

      const resp: BusLinesResponse = {};
      const lines = await this.getAllLines();
      lines.forEach((line) => {
        const { _id, ...lineWithoutId } = line;
        resp[line.id] = lineWithoutId;
      });
      await this.cacheManager.set('bus/lines', resp);
      return resp;
    } catch (exception) {
      console.log('exception', exception);
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message
        },
        exception.message
      );
    }
  }

  async fetchZaragozaLines(): Promise<ValueLabel[]> {
    try {
      const cache: ValueLabel[] =
        await this.cacheManager.get(`bus/lines/available`);
      if (cache) return cache;
      const url = 'https://zaragoza.avanzagrupo.com/lineas-y-horarios/';
      const response = await lastValueFrom(this.httpService.get(url));

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
      console.error('Failed to fetch or parse Zaragoza lines data:', exception);
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message
        },
        exception.message
      );
    }
  }

  async fetchZaragozaLinesFromWeb(): Promise<ValueLabel[]> {
    try {
      const cache: ValueLabel[] = await this.cacheManager.get(`bus/lines/web`);
      if (cache) return cache;
      const url = `https://zaragoza.avanzagrupo.com/lineas-y-horarios`;
      const response = await lastValueFrom(this.httpService.get(url));
      const html = await response.data;

      const lines: ValueLabel[] = [];

      const $ = cheerio.load(html);
      $('#linea-lineas-horarios option').each((_, el) => {
        const value = $(el).attr('value') || '';
        const text = $(el).text().trim();

        if (value === 'lineDefault' || !text.includes('–')) return;

        const label = text.split(' – ').slice(1).join(' - ');
        lines.push({ value, label });
      });

      await this.cacheManager.set(`bus/lines/web`, lines);
      return lines;
    } catch (exception) {
      console.error('Failed to fetch or parse Zaragoza lines data:', exception);
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message
        },
        exception.message
      );
    }
  }

  async fetchZaragozaLineFromKml(id: string): Promise<StationBase[]> {
    try {
      const cache: StationBase[] = await this.cacheManager.get(
        `bus/lines/${id}/kml`
      );
      if (cache) return cache;
      const urls = KmlForLine(id);
      const responses = await Promise.all(
        urls.map((url) => lastValueFrom(this.httpService.get(url)))
      );

      const stations: StationBase[] = [];
      responses.map((response) => {
        const xml = response.data;
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
              coordinates: [lonStr, latStr]
            });
          }
        });
      });

      await this.cacheManager.set(`bus/lines/${id}/kml`, stations);
      return stations;
    } catch (exception) {
      console.error('Failed to fetch or parse Zaragoza lines data:', exception);
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message
        },
        exception.message
      );
    }
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
        { new: true, upsert: true }
      )
      .lean();
  }

  async saveLine(data: Partial<BusLine>) {
    return this.busLineModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { new: true, upsert: true }
      )
      .lean();
  }
}
