import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { BusStationPayload } from 'src/models/bus.interface';
import { IdPayload, ZARAGOZA_PATTERNS } from '@canopus/shared';
import { BusService } from '../services/bus.service';

@Controller()
export class BusController {
  private readonly logger = new Logger('BusController');

  constructor(private readonly busService: BusService) {}

  @MessagePattern(ZARAGOZA_PATTERNS.busStations, Transport.TCP)
  async busStations() {
    return this.busService.getStations().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern(ZARAGOZA_PATTERNS.busStation, Transport.TCP)
  async busStation(@Payload() data: BusStationPayload) {
    if (!data.source) {
      return this.busService.getStation(data.id, 'api').catch(() => {
        return this.busService.getStation(data.id, 'web').catch((ex) => {
          this.logger.error(ex.message);
          return ex.response;
        });
      });
    }
    return this.busService.getStation(data.id, data.source).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern(ZARAGOZA_PATTERNS.busLines, Transport.TCP)
  async busLines() {
    return this.busService.getLines().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern(ZARAGOZA_PATTERNS.busLine, Transport.TCP)
  async busLine(@Payload() data: IdPayload) {
    return this.busService.getLine(data.id).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern(ZARAGOZA_PATTERNS.busLinesUpdate, Transport.TCP)
  async busUpdateLines() {
    return this.busService.getLinesUpdate().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }
}
