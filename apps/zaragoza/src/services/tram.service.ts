import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cache } from 'cache-manager';
import * as Fuse from 'fuse.js';
import { Model } from 'mongoose';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  TramStationResponse,
  TramStationsResponse
} from 'src/models/tram.interface';
import { capitalizeEachWord, fixWords, isInt } from 'src/utils';
import { ErrorResponse } from '../models/common.interface';
import { TramStation, TramStationDocument } from '../schemas/tram.schema';

@Injectable()
export class TramService {
  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(TramStation.name)
    private tramStationModel: Model<TramStationDocument>,
    private httpService: HttpService
  ) {}

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

      const backup = await this.getStationById(id);

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
      }

      const url =
        'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia/';

      const responses = await Promise.all(
        ['1', '2'].map((station) =>
          lastValueFrom(
            this.httpService
              .get(url + `${id.slice(0, id.length - 1) + station}`)
              .pipe(timeout(10000))
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

      await this.cacheManager.set(
        `tram/stations/${id}/${source ?? 'api'}`,
        resp,
        10000
      );
      return resp;
    } catch (exception) {
      if (exception instanceof TimeoutError) {
        throw new InternalServerErrorException(
          {
            statusCode: HttpStatus.REQUEST_TIMEOUT,
            message:
              'Request timeout: The API request took too long to complete'
          },
          'Request timeout: The API request took too long to complete'
        );
      }
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
    return this.tramStationModel.find().sort({ id: 1 }).lean().exec();
  }

  async getStationById(id: string) {
    return this.tramStationModel.findOne({ id }).lean();
  }

  async saveStation(data: Partial<TramStation>) {
    return this.tramStationModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { new: true, upsert: true }
      )
      .lean();
  }
}
