import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { SERVICE_TOKENS, TWITTER_PATTERNS } from '@canopus/shared';

@Injectable()
export class TwitterDownloaderService {
  @Inject(SERVICE_TOKENS.twitterDownloader) private client: ClientProxy;

  getMediaUrls(tweetId: string) {
    return lastValueFrom(
      this.client.send(TWITTER_PATTERNS.getMediaUrls, { tweetId }),
    );
  }
}
