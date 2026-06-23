import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { BiziStationPayload } from 'src/models/bizi.interface';
import { ZARAGOZA_PATTERNS } from '@canopus/shared';
import { BiziService } from '../services/bizi.service';

@Controller()
export class BiziController {
  private readonly logger = new Logger('BiziController');

  constructor(private readonly biziService: BiziService) {}

  @MessagePattern(ZARAGOZA_PATTERNS.biziStations, Transport.TCP)
  async biziStations() {
    return this.biziService.getStations().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern(ZARAGOZA_PATTERNS.biziStation, Transport.TCP)
  async biziStation(@Payload() data: BiziStationPayload) {
    return this.biziService.getStation(data.id, data.source).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern(ZARAGOZA_PATTERNS.biziStationsUpdate, Transport.TCP)
  async biziUpdateStations() {
    return this.biziService.getStationsUpdate().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }
}
