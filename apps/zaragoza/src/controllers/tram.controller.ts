import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { TramStationPayload } from 'src/models/tram.interface';
import { ZARAGOZA_PATTERNS } from '@canopus/shared';
import { TramService } from '../services/tram.service';

@Controller()
export class TramController {
  constructor(private readonly tramService: TramService) {}

  @MessagePattern(ZARAGOZA_PATTERNS.tramStations, Transport.TCP)
  async tramStations() {
    return this.tramService.getStations();
  }

  @MessagePattern(ZARAGOZA_PATTERNS.tramStation, Transport.TCP)
  async tramStation(@Payload() data: TramStationPayload) {
    return this.tramService.getStation(data.id);
  }
}
