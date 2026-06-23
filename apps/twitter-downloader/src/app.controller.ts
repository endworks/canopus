import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { TweetMediaPayload } from './app.interface';
import { AppService } from './app.service';

@Controller()
export class AppController {
  private readonly logger = new Logger('TwitterDownloaderController');
  constructor(private readonly appService: AppService) {}

  @MessagePattern('getMediaUrls', Transport.TCP)
  async getMediaUrls(@Payload() data: TweetMediaPayload) {
    return this.appService.getMediaUrls(data.tweetId).catch((ex) => {
      this.logger.error(ex.message);
      return ex.response;
    });
  }
}
