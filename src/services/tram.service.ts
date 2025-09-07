import { HttpService } from '@nestjs/axios';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotImplementedException
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { lastValueFrom } from 'rxjs';
import { TramStationsResponse } from 'src/models/tram.interface';
import { ErrorResponse } from '../models/common.interface';
import { Cache } from 'cache-manager';

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
  public async getStation(id: string): Promise<ErrorResponse> {
    throw new NotImplementedException(
      {
        statusCode: HttpStatus.NOT_IMPLEMENTED,
        message: `#TODO get station by ID: '${id}'`
      },
      `#TODO`
    );
  }
}
