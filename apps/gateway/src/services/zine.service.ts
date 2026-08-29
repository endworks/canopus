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

  getLocations() {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.locations, {}));
  }

  getCinema(id: string) {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.cinema, { id }));
  }

  getCinemaBasic(id: string) {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.cinemaBasic, { id }));
  }

  getMovies(location?: string) {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.movies, { location }));
  }

  cached() {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.cached, {}));
  }

  prune() {
    return lastValueFrom(this.client.send(ZINE_PATTERNS.prune, {}));
  }

  updateAll(location?: string) {
    return lastValueFrom(
      this.client.send(ZINE_PATTERNS.updateAll, { location }),
    );
  }
}
