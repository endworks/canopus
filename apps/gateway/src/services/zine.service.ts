import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { SERVICE_TOKENS, ZINE_PATTERNS } from '@canopus/shared';

@Injectable()
export class ZineService {
  @Inject(SERVICE_TOKENS.zine) private client: ClientProxy;

  getCinemas(location?: string) {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.cinemas, { location }));
  }

  getCinema(id: string) {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.cinema, { id }));
  }

  getCinemaBasic(id: string) {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.cinemaBasic, { id }));
  }

  getMovies() {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.movies, {}));
  }

  cached() {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.cached, {}));
  }

  updateAll() {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.updateAll, {}));
  }
}
