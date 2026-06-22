import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Response } from 'express';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class ZineService {
  @Inject('ZINE_SERVICE') private client: ClientProxy;

  public getCinemas(res: Response, location?: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('cinemas', { location }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getCinema(res: Response, id: string): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('cinema', { id })).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }

  public getCinemaBasic(res: Response, id: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('cinema/basic', { id }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getMovies(res: Response): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('movies', {})).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }

  public cached(res: Response): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('cached', {})).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }

  public updateAll(res: Response): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('updateAll', {})).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }
}
