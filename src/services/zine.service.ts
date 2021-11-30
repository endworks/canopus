import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';

@Injectable()
export class ZineService {
  @Inject('ZINE_SERVICE') private client: ClientProxy;

  public getCinemas(): Observable<string> {
    return this.client.send<any, any>('cinemas', {});
  }

  public getCinema(id: string): Observable<string> {
    return this.client.send<any, any>('cinema', { id });
  }

  public getCinemaMovies(id: string): Observable<string> {
    return this.client.send<any, any>('cinema/movies', { id });
  }
}
