import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { Response } from 'express';

@Injectable()
export class ZaragozaService {
  @Inject('ZARAGOZA_SERVICE') private client: ClientProxy;

  public getBusStations(res: Response): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('bus/stations', {})).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }

  public getBusStation(
    res: Response,
    id: string,
    source: 'api' | 'web' | 'backup',
  ): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('bus/station', { id, source }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getBusLines(res: Response): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('bus/lines', {})).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }

  public getBusLine(res: Response, id: string): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('bus/line', { id })).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }

  public getTramStations(res: Response): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('tram/stations', {})).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }

  public getTramStation(res: Response, id: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('tram/station', { id }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }
}
