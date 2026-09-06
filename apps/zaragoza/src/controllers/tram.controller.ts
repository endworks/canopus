import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { TramStationPayload } from '../models/tram.interface';
import { IdPayload, ZARAGOZA_PATTERNS } from '@canopus/shared';
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

  @MessagePattern(ZARAGOZA_PATTERNS.tramLines, Transport.TCP)
  async tramLines() {
    return this.tramService.getLines();
  }

  @MessagePattern(ZARAGOZA_PATTERNS.tramLine, Transport.TCP)
  async tramLine(@Payload() data: IdPayload) {
    return this.tramService.getLine(data.id);
  }

  @MessagePattern(ZARAGOZA_PATTERNS.tramAlerts, Transport.TCP)
  async tramAlerts() {
    return this.tramService.getAlerts();
  }

  @MessagePattern(ZARAGOZA_PATTERNS.tramLinesUpdate, Transport.TCP)
  async tramUpdateLines() {
    return this.tramService.getLinesUpdate();
  }
}
