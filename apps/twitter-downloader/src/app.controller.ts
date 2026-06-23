import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { TWITTER_PATTERNS } from '@canopus/shared';
import { TweetMediaPayload } from './app.interface';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @MessagePattern(TWITTER_PATTERNS.getMediaUrls, Transport.TCP)
  async getMediaUrls(@Payload() data: TweetMediaPayload) {
    return this.appService.getMediaUrls(data.tweetId);
  }
}
