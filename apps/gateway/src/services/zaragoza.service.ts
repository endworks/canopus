import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { SERVICE_TOKENS, ZARAGOZA_PATTERNS } from '@canopus/shared';

@Injectable()
export class ZaragozaService {
  @Inject(SERVICE_TOKENS.zaragoza) private client: ClientProxy;

  getBusStations() {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.busStations, {}));
  }

  getBusStation(id: string, source: 'api' | 'web' | 'backup') {
    return lastValueFrom(
      this.client.send(ZARAGOZA_PATTERNS.busStation, { id, source }),
    );
  }

  getBusLines() {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.busLines, {}));
  }

  getBusLine(id: string) {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.busLine, { id }));
  }

  getBusLinesUpdate() {
    return lastValueFrom(
      this.client.send(ZARAGOZA_PATTERNS.busLinesUpdate, {}),
    );
  }

  getTramStations() {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.tramStations, {}));
  }

  getTramStation(id: string, source: 'api' | 'web' | 'backup') {
    return lastValueFrom(
      this.client.send(ZARAGOZA_PATTERNS.tramStation, { id, source }),
    );
  }

  getBiziStations() {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.biziStations, {}));
  }

  getBiziStation(id: string) {
    return lastValueFrom(
      this.client.send(ZARAGOZA_PATTERNS.biziStation, { id }),
    );
  }

  getBiziStationsUpdate() {
    return lastValueFrom(
      this.client.send(ZARAGOZA_PATTERNS.biziStationsUpdate, {}),
    );
  }
}
