import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';

@Injectable()
export class ZaragozaService {
  @Inject('ZARAGOZA_SERVICE') private client: ClientProxy;

  public getBusStation(id: string): Observable<string> {
    return this.client.send<any, any>('bus/station', { id });
  }

  public getTramStation(id: string): Observable<string> {
    return this.client.send<any, any>('tram/station', { id });
  }
}
