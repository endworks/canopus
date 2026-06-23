import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { SearchPayload } from './app.interface';
import { AppService } from './app.service';

@Controller()
export class AppController {
  private readonly logger = new Logger('AppController');
  constructor(private readonly appService: AppService) {}

  @MessagePattern('search', Transport.TCP)
  async search(@Payload() data: SearchPayload) {
    return this.appService.search(data.term).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }
}
