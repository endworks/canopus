import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { RAE_PATTERNS } from '@canopus/shared';
import { SearchPayload } from './app.interface';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @MessagePattern(RAE_PATTERNS.search, Transport.TCP)
  async search(@Payload() data: SearchPayload) {
    return this.appService.search(data.term);
  }
}
