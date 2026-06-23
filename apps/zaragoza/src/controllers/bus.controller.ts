import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { BusStationPayload } from 'src/models/bus.interface';
import { IdPayload, ZARAGOZA_PATTERNS } from '@canopus/shared';
import { BusService } from '../services/bus.service';

@Controller()
export class BusController {
  constructor(private readonly busService: BusService) {}

  @MessagePattern(ZARAGOZA_PATTERNS.busStations, Transport.TCP)
  async busStations() {
    return this.busService.getStations();
  }

  @MessagePattern(ZARAGOZA_PATTERNS.busStation, Transport.TCP)
  async busStation(@Payload() data: BusStationPayload) {
    // Fall back to the web source when the API source fails; a failure of the
    // fallback propagates to the global RpcErrorFilter.
    if (!data.source) {
      return this.busService
        .getStation(data.id, 'api')
        .catch(() => this.busService.getStation(data.id, 'web'));
    }
    return this.busService.getStation(data.id, data.source);
  }

  @MessagePattern(ZARAGOZA_PATTERNS.busLines, Transport.TCP)
  async busLines() {
    return this.busService.getLines();
  }

  @MessagePattern(ZARAGOZA_PATTERNS.busLine, Transport.TCP)
  async busLine(@Payload() data: IdPayload) {
    return this.busService.getLine(data.id);
  }

  @MessagePattern(ZARAGOZA_PATTERNS.busLinesUpdate, Transport.TCP)
  async busUpdateLines() {
    return this.busService.getLinesUpdate();
  }
}
