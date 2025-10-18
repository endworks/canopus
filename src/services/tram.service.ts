import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import axios from 'axios';
import { Cache } from 'cache-manager';
import * as Fuse from 'fuse.js';
import { lastValueFrom } from 'rxjs';
import {
  TramStationResponse,
  TramStationsResponse
} from 'src/models/tram.interface';
import { capitalizeEachWord, fixWords, isInt } from 'src/utils';
import { ErrorResponse } from '../models/common.interface';

@Injectable()
export class TramService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService
  ) {}

  // Stations
  public async getStations(): Promise<TramStationsResponse | ErrorResponse> {
    try {
      const cache: TramStationsResponse =
        await this.cacheManager.get(`tram/stations`);
      if (cache) return cache;
      const url =
        'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia';
      const response = await lastValueFrom(this.httpService.get(url));

      const stations: TramStationsResponse = {};
      response.data.result.forEach((station) => {
        const stationId = station.id.slice(0, station.id.length - 1) + '0';
        if (!stations[stationId]) {
          stations[stationId] = {
            id: stationId,
            street: capitalizeEachWord(fixWords(station.title)),
            lines: ['L1'],
            times:
              station.destinos?.map((destino) => {
                return {
                  line: destino.linea,
                  destination: capitalizeEachWord(fixWords(destino.destino)),
                  time: `${destino.minutos} min.`
                };
              }) || [],
            coordinates: station.geometry.coordinates,
            source: 'api',
            sourceUrl: station.uri,
            lastUpdated: station.lastUpdated,
            type: 'tram'
          };
        } else {
          stations[stationId].times.push(
            ...(station.destinos?.map((destino) => {
              return {
                line: destino.linea,
                destination: capitalizeEachWord(fixWords(destino.destino)),
                time: `${destino.minutos} min.`
              };
            }) || [])
          );
        }
      });

      const backupUrl = `https://zgzpls.firebaseio.com/tram/stations.json`;
      await axios.put(backupUrl, stations);

      await this.cacheManager.set(`tram/stations`, stations);
      return stations;
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
  ): Promise<TramStationResponse | ErrorResponse> {
    try {
      if (!isInt(id)) {
        const stationResponse = await this.getStations();
        const stations = Object.keys(stationResponse).map(
          (station) => stationResponse[station]
        );
        console.log(
          'stations',
          stations.length,
          Object.keys(stationResponse).length
        );

        const fuse = new Fuse.default(stations, {
          keys: ['street'],
          includeScore: true,
          threshold: 0.4
        });
        const results = fuse.search(id);
        console.log(results);
      }

      const cache: TramStationResponse = await this.cacheManager.get(
        `tram/stations/${id}`
      );
      if (cache) return cache;

      let backup = null;
      const backupUrl = `https://zgzpls.firebaseio.com/tram/stations/${id}.json`;
      try {
        const backupResponse = await lastValueFrom(
          this.httpService.get(backupUrl)
        );
        backup = backupResponse.data;
      } catch {
        backup = null;
      }

      const resp: TramStationResponse = {
        id: id,
        street: null,
        lines: [],
        times: [],
        coordinates: [],
        source: null,
        sourceUrl: null,
        type: 'tram'
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

        resp.source = 'backup';
        resp.sourceUrl = backupUrl;
      }

      const url =
        'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia/';

      const responses = await Promise.all(
        ['1', '2'].map((station) =>
          lastValueFrom(
            this.httpService.get(
              url + `${id.slice(0, id.length - 1) + station}`
            )
          )
        )
      );

      responses.forEach((response) => {
        const station = response.data;
        resp.times.push(
          ...(station.destinos?.map((destino) => {
            return {
              line: destino.linea,
              destination: capitalizeEachWord(fixWords(destino.destino)),
              time: `${destino.minutos} min.`
            };
          }) || [])
        );
      });

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
      resp.source = 'api';

      await axios.put(backupUrl, resp);
      await this.cacheManager.set(
        `tram/stations/${id}/${source ?? 'api'}`,
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
  }
}
