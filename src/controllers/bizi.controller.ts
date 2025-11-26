import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { BiziStationPayload } from 'src/models/bizi.interface';
import { BiziService } from '../services/bizi.service';

@Controller()
export class BiziController {
  private readonly logger = new Logger('BiziController');

  constructor(private readonly biziService: BiziService) {}

  @MessagePattern('bizi/stations', Transport.TCP)
  async biziStations() {
    return this.biziService.getStations().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('bizi/station', Transport.TCP)
  async biziStation(@Payload() data: BiziStationPayload) {
    return this.biziService.getStation(data.id, data.source).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('bizi/stations/update', Transport.TCP)
  async biziUpdateStations() {
    return this.biziService.getStationsUpdate().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }
}
