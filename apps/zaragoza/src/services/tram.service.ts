import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';
import {
  TramStationResponse,
  TramStationsResponse,
} from '../models/tram.interface';
import {
  capitalizeEachWord,
  compareArrivalTimes,
  fixWords,
  notFoundById,
} from '../utils';
import { ErrorResponse } from '@canopus/shared';
import { fetchWithTimeout, upstreamFailure } from '@canopus/nest';
import { TramStation, TramStationDocument } from '../schemas/tram.schema';

@Injectable()
export class TramService {
  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(TramStation.name)
    private tramStationModel: Model<TramStationDocument>,
    private httpService: HttpService,
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
          message: exception.message,
        },
        exception.message,
      );
    }
  }

  // Station
  public async getStation(
    id: string,
  ): Promise<TramStationResponse | ErrorResponse> {
    try {
      const cache: TramStationResponse = await this.cacheManager.get(
        `tram/stations/${id}`,
      );
      if (cache) return cache;

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

      const url =
        'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia/';

      const stations = await Promise.all(
        ['1', '2'].map((platform) =>
          fetchWithTimeout<any>(
            this.httpService,
            url + `${id.slice(0, id.length - 1) + platform}`,
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

      await this.cacheManager.set(`tram/stations/${id}`, resp, 10000);
      return resp;
    } catch (exception) {
      throw upstreamFailure(exception, 'The tram API', notFoundById(id));
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
        { returnDocument: 'after', upsert: true },
      )
      .lean();
  }
}
