import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Response } from 'express';
import { lastValueFrom } from 'rxjs';
import { SERVICE_TOKENS, ZARAGOZA_PATTERNS } from '@canopus/shared';

@Injectable()
export class ZaragozaService {
  @Inject(SERVICE_TOKENS.zaragoza) private client: ClientProxy;

  public getBusStations(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.busStations, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getBusStation(
    res: Response,
    id: string,
    source: 'api' | 'web' | 'backup',
  ): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.busStation, { id, source }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getBusLines(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.busLines, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getBusLine(res: Response, id: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.busLine, { id }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getBusLinesUpdate(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.busLinesUpdate, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getTramStations(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.tramStations, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getTramStation(
    res: Response,
    id: string,
    source: 'api' | 'web' | 'backup',
  ): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.tramStation, { id, source }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getBiziStations(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.biziStations, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getBiziStation(res: Response, id: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.biziStation, { id }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public getBiziStationsUpdate(res: Response): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(ZARAGOZA_PATTERNS.biziStationsUpdate, {}),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }
}
