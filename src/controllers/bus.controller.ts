import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { BusStationPayload } from 'src/models/bus.interface';
import { IdPayload } from 'src/models/common.interface';
import { BusService } from '../services/bus.service';

@Controller()
export class BusController {
  private readonly logger = new Logger('BusController');

  constructor(private readonly busService: BusService) {}

  @MessagePattern('bus/stations', Transport.TCP)
  async busStations() {
    return this.busService.getStations().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('bus/station', Transport.TCP)
  async busStation(@Payload() data: BusStationPayload) {
    return this.busService.getStation(data.id, data.source).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('bus/lines', Transport.TCP)
  async busLines() {
    return this.busService.getLines().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('bus/line', Transport.TCP)
  async busLine(@Payload() data: IdPayload) {
    return this.busService.getLine(data.id).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('bus/lines/update', Transport.TCP)
  async busUpdateLines() {
    return this.busService.getLinesUpdate().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }
}
