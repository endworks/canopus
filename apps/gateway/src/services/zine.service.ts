import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Response } from 'express';
import { lastValueFrom } from 'rxjs';
import { SERVICE_TOKENS, ZINE_PATTERNS } from '@canopus/shared';

@Injectable()
export class ZineService {
  @Inject(SERVICE_TOKENS.zine) private client: ClientProxy;

  public getCinemas(res: Response, location?: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZINE_PATTERNS.cinemas, { location }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getCinema(res: Response, id: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZINE_PATTERNS.cinema, { id }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getCinemaBasic(res: Response, id: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZINE_PATTERNS.cinemaBasic, { id }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getMovies(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZINE_PATTERNS.movies, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public cached(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZINE_PATTERNS.cached, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public updateAll(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZINE_PATTERNS.updateAll, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }
}
