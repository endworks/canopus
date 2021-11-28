import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';

@Injectable()
export class ZaragozaService {
  @Inject('ZARAGOZA_SERVICE') private client: ClientProxy;

  public getBusStations(): Observable<string> {
    return this.client.send<any, any>('bus/stations', {});
  }

  public getBusStation(
    id: string,
    source: 'api' | 'web' | 'backup',
  ): Observable<string> {
    return this.client.send<any, any>('bus/station', { id, source });
  }

  public getBusLines(): Observable<string> {
    return this.client.send<any, any>('bus/lines', {});
  }

  public getBusLine(id: string): Observable<string> {
    return this.client.send<any, any>('bus/line', { id });
  }

  public getTramStations(): Observable<string> {
    return this.client.send<any, any>('tram/stations', {});
  }

  public getTramStation(id: string): Observable<string> {
    return this.client.send<any, any>('tram/station', { id });
  }

  public getCinemas(): Observable<string> {
    return this.client.send<any, any>('cinemas', {});
  }

  public getCinema(id: string): Observable<string> {
    return this.client.send<any, any>('cinema', { id });
  }

  public getCinemaSessions(id: string): Observable<string> {
    return this.client.send<any, any>('cinema/sessions', { id });
  }
}
