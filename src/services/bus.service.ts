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

    let backup = null;
    const backupUrl = `https://zgzpls.firebaseio.com/bus/stations/tuzsa-${id}.json`;
    try {
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
          sourceUrl: null,
          type: 'bus'
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

        if (!source || source === 'api') {
          resp.source = 'api';
          resp.sourceUrl = url;
          resp.lastUpdated = response.data.lastUpdated;
          resp.street = capitalizeEachWord(
            fixWords(
              response.data.title.split(')')[1].slice(1).split('Lí')[0].trim()
            )
          );
          resp.coordinates = response.data.geometry.coordinates;
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
          return { ...backup, source: 'backup', sourceUrl: backupUrl };
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

        await axios.put(backupUrl, resp);
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
      const url = `https://zgzpls.firebaseio.com/bus/lines/${id}.json`;
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

  public async getLinesUpdate(
    source?: string
  ): Promise<BusLinesResponse | ErrorResponse> {
    try {
      /*
      const busApiURL =
        'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/linea-autobus';

      const url = busApiURL;
      */

      let backup: BusLinesResponse = null;
      const backupUrl = 'https://zgzpls.firebaseio.com/bus/lines.json';
      try {
        const backupResponse = await lastValueFrom(
          this.httpService.get(backupUrl)
        );
        backup = backupResponse.data;
      } catch {
        backup = null;
      }

      //const response = await lastValueFrom(this.httpService.get(url));
      const webLines = await this.fetchZaragozaLinesFromWeb();
      const availableLines = await this.fetchZaragozaLines();
      const linesToBeUpdated = [];

      for (const line of availableLines) {
        //if (!backup[line.value].stations) {
        linesToBeUpdated.push(line.value);
        //}
      }

      /*await Promise.all(
        response.data.result.map(async (lineUrl: string) => {
          const resp = await lastValueFrom(this.httpService.get(lineUrl));
          const lineId = lineUrl.split('/').pop();
          const found = availableLines.find(
            (line) => line.value.toUpperCase() == lineId.toUpperCase()
          );
          const name = found
            ? found.label
                .split(' - ')
                .slice(1)
                .map((word) => capitalizeEachWord(fixWords(word.trim())))
                .join(' - ')
            : undefined;
          const line: BusLineResponse = {
            ...backup[found?.value || lineId],
            id: found?.value || lineId,
            number: found?.value || lineId,
            name: name ?? backup[found?.value || lineId].name,
            stations: resp.data.result,
            lastUpdated: resp.data.lastUpdated,
            hidden: Boolean(!found)
          };
          if (
            !resp.data.result &&
            availableLines.find((item) => item.value === lineId)
          ) {
            linesToBeUpdated.push(lineId);
          }
          const backupLineUrl = `https://zgzpls.firebaseio.com/bus/lines/${line.id}.json`;
          await axios.put(backupLineUrl, line);
        })
      );*/

      await Promise.all(
        linesToBeUpdated.map(async (lineId) => {
          const lineStations = await this.fetchZaragozaLineFromWeb(lineId);
          const stations = [];

          for (const missingStation of lineStations) {
            let found;
            for (const line in backup) {
              found = backup[line].stations?.find(
                (station) =>
                  station.description === `Poste ${missingStation.value}`
              );
              if (found) {
                stations.push(found);
                break;
              }
            }
            if (!found) {
              console.log('not found', missingStation);
              const stationData = {
                about: `http://www.zaragoza.es/api/recurso/urbanismo-infraestructuras/transporte-urbano/poste/tuzsa-${missingStation.value}`,
                description: `Poste ${missingStation.value}`,
                link: `http://www.urbanosdezaragoza.es/frm_esquemaparadatime.php?poste=${missingStation.value}`,
                title: missingStation.label,
                geometry: {
                  coordinates: [0, 0],
                  type: 'Point'
                }
              };
              stations.push(stationData);
            }
          }

          const hidden = !stations.length ? true : undefined;
          const line: BusLineResponse = {
            id: lineId,
            number: lineId,
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
          const backupLineUrl = `https://zgzpls.firebaseio.com/bus/lines/${lineId}.json`;
          await axios.patch(backupLineUrl, line);
        })
      );

      try {
        const backupResponse = await lastValueFrom(
          this.httpService.get(backupUrl)
        );
        backup = backupResponse.data;
      } catch {
        backup = null;
      }
      await this.cacheManager.set('bus/lines', backup);
      return backup;
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

  async fetchZaragozaLines(): Promise<{ value: string; label: string }[]> {
    try {
      const cache: { value: string; label: string }[] =
        await this.cacheManager.get(`bus/lines/available`);
      if (cache) return cache;
      const url = 'https://zaragoza.avanzagrupo.com/lineas-y-horarios/';
      const response = await lastValueFrom(this.httpService.get(url));

      const html = await response.data;

      const $ = cheerio.load(html);

      const lines: { value: string; label: string }[] = [];

      $('select#linea-lineas-horarios option').each((_, el) => {
        const value = $(el).attr('value');
        const label = $(el).text().trim();

        if (value && value !== 'default') {
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

  async fetchZaragozaLinesFromWeb(): Promise<
    { value: string; label: string }[]
  > {
    try {
      const cache: { value: string; label: string }[] =
        await this.cacheManager.get(`bus/lines/web`);
      if (cache) return cache;
      const url = `https://zaragoza.avanzagrupo.com/lineas-y-horarios`;
      const response = await lastValueFrom(this.httpService.get(url));
      const html = await response.data;

      const lines: { value: string; label: string }[] = [];

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

  async fetchZaragozaLineFromWeb(
    id: string
  ): Promise<{ value: string; label: string }[]> {
    try {
      const cache: { value: string; label: string }[] =
        await this.cacheManager.get(`bus/lines/${id}/web`);
      if (cache) return cache;
      const url = `https://zaragoza.avanzagrupo.com/lineas-y-horarios/?selectLinea=${id}&selectSentido=-1`;
      const response = await lastValueFrom(this.httpService.get(url));
      const html = await response.data;

      const stations: { value: string; label: string }[] = [];

      const getStationsFromDestination = (html: string) => {
        const $ = cheerio.load(html);
        $('.wrapper-line-stops .container-stop').each((_, el) => {
          const value = $(el).attr('value');
          const label = $(el).find('.stopName').text().trim();
          stations.push({ value, label });
        });
      };

      getStationsFromDestination(html);

      const $ = cheerio.load(html);
      const destinations = $('select#sentido-lineas-horarios option').length;

      if (destinations > 1) {
        const url = `https://zaragoza.avanzagrupo.com/lineas-y-horarios/?selectLinea=${id}&selectSentido=-2`;
        const response = await lastValueFrom(this.httpService.get(url));
        const html = await response.data;

        getStationsFromDestination(html);
      }

      await this.cacheManager.set(`bus/lines/${id}/web`, stations);
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

  async fetchZaragozaLinesLegacy(): Promise<
    { value: string; label: string }[]
  > {
    try {
      const cache: { value: string; label: string }[] =
        await this.cacheManager.get(`bus/lines/available`);
      if (cache) return cache;
      const response = await fetch(
        'https://nps.avanzagrupo.com/lineas_zaragoza.js'
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const scriptText = await response.text();

      const startMarker = 'const ZARAGOZA_LINES = ';
      const endMarker = ';';

      const startIndex = scriptText.indexOf(startMarker);
      const endIndex = scriptText.lastIndexOf(endMarker);

      if (startIndex === -1 || endIndex === -1) {
        throw new Error('Variable definition markers not found in script.');
      }

      const rawArrayString = scriptText
        .substring(startIndex + startMarker.length, endIndex)
        .trim();

      let cleanJsonString = rawArrayString;
      cleanJsonString = cleanJsonString
        .replace(/value:/g, '"value":')
        .replace(/label:/g, '"label":');
      cleanJsonString = cleanJsonString.replace(/'/g, '"');
      const linesArray = JSON.parse(cleanJsonString);

      await this.cacheManager.set(`bus/lines/available`, linesArray);
      return linesArray;
    } catch (error) {
      console.error('Failed to fetch or parse Zaragoza lines data:', error);
      throw error;
    }
  }
}
