import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { lastValueFrom } from 'rxjs';
import {
  TramStationResponse,
  TramStationsResponse
} from 'src/models/tram.interface';
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
      const url = 'https://zgzpls.firebaseio.com/tram/stations.json';
      const response = await lastValueFrom(this.httpService.get(url));
      await this.cacheManager.set(`tram/stations`, response.data);
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
  ): Promise<TramStationResponse | ErrorResponse> {
    try {
      const cache: TramStationResponse = await this.cacheManager.get(
        `tram/stations/${id}`
      );
      if (cache) return cache;

      let backup = null;
      const backupUrl = `https://zgzpls.firebaseio.com/tram/stations/tram-${id}.json`;
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

      await this.cacheManager.set(`tram/stations/${id}`, resp);
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
