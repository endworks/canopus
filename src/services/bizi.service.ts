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
import { Model } from 'mongoose';
import { lastValueFrom } from 'rxjs';
import {
  BiziApiResponse,
  BiziStationApiResponse
} from '../models/api-responses.interface';
import {
  BiziStationResponse,
  BiziStationsResponse
} from '../models/bizi.interface';
import { ErrorResponse } from '../models/common.interface';
import { BiziStation, BiziStationDocument } from '../schemas/bizi.schema';
import { capitalizeEachWord, fixWords } from '../utils';

const biziApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/estacion-bicicleta.json';
const biziStationApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/estacion-bicicleta';

@Injectable()
export class BiziService {
  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(BiziStation.name)
    private biziStationModel: Model<BiziStationDocument>,
    private httpService: HttpService
  ) {}

  public async getStations(): Promise<BiziStationsResponse | ErrorResponse> {
    try {
      const cache: BiziStationsResponse =
        await this.cacheManager.get('bizi/stations');
      if (cache) return cache;

      const resp: BiziStationsResponse = {};
      const stations = await this.getAllStations();
      stations.forEach((station) => {
        const { _id, ...stationWithoutId } = station;
        resp[station.id] = {
          ...stationWithoutId,
          state: null,
          bikes: null,
          openDocks: null
        };
      });
      await this.cacheManager.set(`bizi/stations`, resp);
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

  public async getStation(
    id: string,
    source?: string
  ): Promise<BiziStationResponse | ErrorResponse> {
    const cache: BiziStationResponse = await this.cacheManager.get(
      `bizi/stations/${id}/${source ?? 'api'}`
    );
    if (cache) return cache;

    try {
      const response = await lastValueFrom(
        this.httpService.get<BiziStationApiResponse>(
          `${biziStationApiURL}/${id}.json`
        )
      );

      const stationData = response.data;

      const backup = await this.getStationById(id);

      const titleParts = stationData.title.split('-');
      const streetName =
        titleParts.length > 1
          ? titleParts.slice(1).join('-').trim()
          : stationData.title;

      const resp: BiziStationResponse = {
        id: id,
        street: backup?.street || capitalizeEachWord(fixWords(streetName)),
        state: stationData.estado,
        bikes: stationData.bicisDisponibles,
        openDocks: stationData.anclajesDisponibles,
        coordinates:
          backup?.coordinates ||
          stationData.geometry.coordinates.map((coord) => coord.toString()),
        source: 'api',
        sourceUrl: stationData.about || `${biziStationApiURL}/${id}.json`,
        lastUpdated: stationData.lastUpdated,
        type: 'bizi'
      };

      await this.cacheManager.set(
        `bizi/stations/${id}/${source ?? 'api'}`,
        resp,
        10000
      );

      return resp;
    } catch (exception) {
      if (exception instanceof NotFoundException) {
        throw exception;
      }
      if (exception.response?.status === HttpStatus.NOT_FOUND) {
        throw new NotFoundException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Resource with ID '${id}' was not found`
          },
          `Resource with ID '${id}' was not found`
        );
      }
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.response?.data?.mensaje || exception.message
        },
        exception.response?.data?.mensaje || exception.message
      );
    }
  }

  public async getStationsUpdate(): Promise<
    BiziStationsResponse | ErrorResponse
  > {
    try {
      const allStations: BiziStationResponse[] = [];
      let start = 0;
      const rows = 50;
      let hasMore = true;

      while (hasMore) {
        const response = await lastValueFrom(
          this.httpService.get<BiziApiResponse>(
            `${biziApiURL}?start=${start}&rows=${rows}&srsname=wgs84`
          )
        );

        const stations = await Promise.all(
          response.data.result.map(async (station) => {
            const titleParts = station.title.split('-');
            const streetName =
              titleParts.length > 1
                ? titleParts.slice(1).join('-').trim()
                : station.title;

            const stationResponse: BiziStationResponse = {
              id: station.id,
              street: capitalizeEachWord(fixWords(streetName)),
              state: station.estado,
              bikes: station.bicisDisponibles,
              openDocks: station.anclajesDisponibles,
              coordinates: station.geometry.coordinates.map((coord) =>
                coord.toString()
              ),
              source: 'api',
              sourceUrl: station.about || `${biziApiURL}?id=${station.id}`,
              lastUpdated: station.lastUpdated,
              type: 'bizi'
            };

            await this.saveStation({
              id: station.id,
              street: capitalizeEachWord(fixWords(streetName)),
              coordinates: station.geometry.coordinates.map((coord) =>
                coord.toString()
              ),
              source: 'api',
              sourceUrl: station.about || `${biziApiURL}?id=${station.id}`,
              type: 'bizi'
            });

            return stationResponse;
          })
        );

        allStations.push(...stations);

        if (start + rows >= response.data.totalCount) {
          hasMore = false;
        } else {
          start += rows;
        }
      }

      const resp: BiziStationsResponse = {};
      allStations.forEach((station) => {
        resp[station.id] = station;
      });

      await this.cacheManager.set('bizi/stations', resp);
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

  async getAllStations() {
    return this.biziStationModel.find().sort({ id: 1 }).lean().exec();
  }

  async getStationById(id: string) {
    return this.biziStationModel.findOne({ id }).lean();
  }

  async saveStation(data: Partial<BiziStation>) {
    return this.biziStationModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { new: true, upsert: true }
      )
      .lean();
  }
}
