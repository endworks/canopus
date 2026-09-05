import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import {
  SERVICE_TOKENS,
  StationSource,
  ZARAGOZA_PATTERNS,
} from '@canopus/shared';

@Injectable()
export class ZaragozaService {
  @Inject(SERVICE_TOKENS.zaragoza) private client: ClientProxy;

  getBusStations() {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.busStations, {}));
  }

  getBusStation(id: string, source: StationSource) {
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

  getBusAlerts() {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.busAlerts, {}));
  }

  getBusLinesUpdate() {
    return lastValueFrom(
      this.client.send(ZARAGOZA_PATTERNS.busLinesUpdate, {}),
    );
  }

  getTramStations() {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.tramStations, {}));
  }

  getTramStation(id: string) {
    return lastValueFrom(
      this.client.send(ZARAGOZA_PATTERNS.tramStation, { id }),
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

  getPlaces(kind: string) {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.places, { kind }));
  }

  getPlace(kind: string, id: string) {
    return lastValueFrom(
      this.client.send(ZARAGOZA_PATTERNS.place, { kind, id }),
    );
  }

  getLiveTaxis() {
    return lastValueFrom(this.client.send(ZARAGOZA_PATTERNS.taxis, {}));
  }
}
