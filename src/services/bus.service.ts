import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import axios from 'axios';
import { Cache } from 'cache-manager';
import * as cheerio from 'cheerio';
import { lastValueFrom } from 'rxjs';
import {
  BusLineResponse,
  BusLinesResponse,
  BusStationResponse,
  BusStationsResponse
} from '../models/bus.interface';
import { ErrorResponse } from '../models/common.interface';
import { capitalize, capitalizeEachWord, fixWords } from '../utils';

const busApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/poste-autobus/tuzsa-';
const busWebURL =
  'https://zaragoza-pasobus.avanzagrupo.com/frm_esquemaparadatime.php?poste=';

@Injectable()
export class BusService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService
  ) {}

  // Stations
  public async getStations(): Promise<BusStationsResponse | ErrorResponse> {
    try {
      const cache: BusStationsResponse =
        await this.cacheManager.get('bus/stations');
      if (cache) return cache;
      const url = 'https://zgzpls.firebaseio.com/bus/stations.json';
      const response = await lastValueFrom(this.httpService.get(url));
      await this.cacheManager.set(`bus/stations`, response.data);
      return response.data;
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
    source: string
  ): Promise<BusStationResponse | ErrorResponse> {
    const cache: BusStationResponse = await this.cacheManager.get(
      `bus/stations/${id}/${source}`
    );
    if (cache) return cache;
    const url =
      source && source === 'web'
        ? busWebURL + id
        : `${busApiURL + id}.json?srsname=wgs84`;

    let backup;
    try {
      const backupUrl = `https://zgzpls.firebaseio.com/bus/stations/tuzsa-${id}.json`;
      const backupResponse = await lastValueFrom(
        this.httpService.get(backupUrl)
      );
      backup = backupResponse.data;
    } catch {
      backup = null;
    }

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
          type: 'bus'
        };

        if (backup) {
          resp.street = backup.street;
          resp.lines = backup.lines;
          resp.coordinates = backup.coordinates;
        }

        if (!source || source === 'api') {
          resp.source = source;
          resp.sourceUrl = url;
          resp.lastUpdated = response.data.lastUpdated;
          resp.street = capitalizeEachWord(
            response.data.title.split(')')[1].slice(1).split('Lí')[0].trim()
          );
          resp.lines = response.data.title
            .split(resp.street)[1]
            .trim()
            .replace('Líneas: ', '')
            .split(', ');
          resp.coordinates = response.data.geometry.coordinates;
          const times = [];
          response.data.destinos.map((destination) => {
            ['primero', 'segundo'].map((element) => {
              const transport = {
                line: destination.linea,
                destination: capitalizeEachWord(
                  fixWords(
                    destination.destino
                      .replace(/(^,)|(,$)/g, '')
                      .replace(/(^\.)|(\.$)/g, '')
                  ),
                  true
                )
              };
              if (destination[element].includes('minutos')) {
                times.push({
                  ...transport,
                  time: `${destination[element]
                    .replace(' minutos', '')
                    .replace(/(^\.)|(\.$)/g, '')} min.`
                });
              } else if (destination[element]?.includes('Sin estimacin')) {
                times.push({
                  ...transport,
                  time: capitalize(
                    fixWords(destination[element].replace(/(^\.)|(\.$)/g, ''))
                  )
                });
              } else {
                times.push({
                  ...transport,
                  time: capitalize(destination[element])
                });
              }
            });
          });
          resp.times = [...times];
        } else if (source === 'web') {
          const response = await axios.get(url);
          const $ = cheerio.load(response.data);
          const seenLines = new Set<string>();

          const rows = $('table').eq(1).find('tr');

          rows.each((_, row) => {
            const cells = $(row).find('td.digital');
            if (cells.length >= 3) {
              const line = $(cells[0]).text().trim();
              const destination = fixWords($(cells[1]).text().trim());
              const time = $(cells[2]).text().trim();

              if (line) {
                resp.times.push({ line, destination, time });
                seenLines.add(line);
              }
            }
          });

          resp.source = source;
          resp.sourceUrl = url;
          resp.lines = Array.from(seenLines).sort();
          resp.lastUpdated = new Date().toISOString();
        } else if (source === 'backup') {
          return { ...backup, source, sourceUrl: null };
        } else {
          throw new NotFoundException(
            {
              statusCode: HttpStatus.NOT_FOUND,
              message: `Resource with ID '${id}' was not found`
            },
            `Resource with ID '${id}' was not found`
          );
        }
        resp.times.sort((a, b) => {
          if (a.time.includes('min') && b.time.includes('min')) {
            const sort =
              parseInt(a.time.split(' ')[0]) < parseInt(b.time.split(' ')[0])
                ? -1
                : 1;
            return sort;
          } else {
            if (a.time.includes('parada')) {
              return -1;
            }
            if (b.time.includes('Sin')) {
              return 1;
            }
          }
          return -1;
        });

        const updateUrl = `https://zgzpls.firebaseio.com/bus/stations/tuzsa-${id}.json`;
        await this.httpService.put(updateUrl, resp);
        await this.cacheManager.set(`bus/stations/${id}/${source}`, resp);

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
            message: exception.response.data.mensaje || exception.message
          },
          exception.response.data.mensaje || exception.message
        );
      }
    }
  }

  // Lines
  public async getLines(): Promise<BusLinesResponse | ErrorResponse> {
    try {
      const cache: BusLinesResponse = await this.cacheManager.get(`bus/lines`);
      if (cache) return cache;
      const url = 'https://zgzpls.firebaseio.com/bus/lines.json';
      const response = await lastValueFrom(this.httpService.get(url));
      await this.cacheManager.set(`bus/lines`, response.data);
      return response.data;
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
      const url = `https://zgzpls.firebaseio.com/bus/lines/tuzsa-${id}.json`;
      const response = await lastValueFrom(this.httpService.get(url));
      if (!response.data) {
        throw new NotFoundException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Resource with ID '${id}' was not found`
          },
          `Resource with ID '${id}' was not found`
        );
      }
      await this.cacheManager.set(`bus/lines/${id}`, response.data);
      return response.data;
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
}
