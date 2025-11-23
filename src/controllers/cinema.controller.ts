import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { CinemaPayload } from '../models/cinema.interface';
import { IdPayload } from '../models/common.interface';
import { CinemaService } from '../services/cinema.service';

@Controller()
export class CinemaController {
  private readonly logger = new Logger('CinemaController');

  constructor(private readonly cinemaService: CinemaService) {}

  @MessagePattern('cinemas', Transport.TCP)
  async cinemas(@Payload() data: CinemaPayload) {
    return this.cinemaService.getCinemas(data.location).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('cinema', Transport.TCP)
  async cinema(@Payload() data: IdPayload) {
    return this.cinemaService.getCinema(data.id).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('cinema/basic', Transport.TCP)
  async cinemaBasic(@Payload() data: IdPayload) {
    return this.cinemaService.getCinemaBasic(data.id).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('cached', Transport.TCP)
  async cached() {
    return this.cinemaService.cached().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }

  @MessagePattern('updateAll', Transport.TCP)
  async updateAll() {
    return this.cinemaService.updateAll().catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }
}
