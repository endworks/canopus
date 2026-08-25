import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import {
  CinemaPayload,
  MoviePayload,
  UpdatePayload,
} from '../models/cinema.interface';
import { IdPayload, ZINE_PATTERNS } from '@canopus/shared';
import { CinemaService } from '../services/cinema.service';

@Controller()
export class CinemaController {
  constructor(private readonly cinemaService: CinemaService) {}

  @MessagePattern(ZINE_PATTERNS.cinemas, Transport.TCP)
  async cinemas(@Payload() data: CinemaPayload) {
    return this.cinemaService.getCinemas(data.location);
  }

  @MessagePattern(ZINE_PATTERNS.cinema, Transport.TCP)
  async cinema(@Payload() data: IdPayload) {
    return this.cinemaService.getCinema(data.id);
  }

  @MessagePattern(ZINE_PATTERNS.cinemaBasic, Transport.TCP)
  async cinemaBasic(@Payload() data: IdPayload) {
    return this.cinemaService.getCinemaBasic(data.id);
  }

  @MessagePattern(ZINE_PATTERNS.movies, Transport.TCP)
  async movies(@Payload() data: MoviePayload) {
    return this.cinemaService.getMovies(data.location);
  }

  @MessagePattern(ZINE_PATTERNS.cached, Transport.TCP)
  async cached() {
    return this.cinemaService.cached();
  }

  @MessagePattern(ZINE_PATTERNS.prune, Transport.TCP)
  async prune() {
    return this.cinemaService.prune();
  }

  @MessagePattern(ZINE_PATTERNS.updateAll, Transport.TCP)
  async updateAll(@Payload() data: UpdatePayload) {
    return this.cinemaService.updateAll(data.location);
  }
}
