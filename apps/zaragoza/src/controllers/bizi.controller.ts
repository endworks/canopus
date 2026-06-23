import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { BiziStationPayload } from 'src/models/bizi.interface';
import { ZARAGOZA_PATTERNS } from '@canopus/shared';
import { BiziService } from '../services/bizi.service';

@Controller()
export class BiziController {
  constructor(private readonly biziService: BiziService) {}

  @MessagePattern(ZARAGOZA_PATTERNS.biziStations, Transport.TCP)
  async biziStations() {
    return this.biziService.getStations();
  }

  @MessagePattern(ZARAGOZA_PATTERNS.biziStation, Transport.TCP)
  async biziStation(@Payload() data: BiziStationPayload) {
    return this.biziService.getStation(data.id, data.source);
  }

  @MessagePattern(ZARAGOZA_PATTERNS.biziStationsUpdate, Transport.TCP)
  async biziUpdateStations() {
    return this.biziService.getStationsUpdate();
  }
}
