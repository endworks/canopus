import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { Response } from 'express';
import { SERVICE_TOKENS, TWITTER_PATTERNS } from '@canopus/shared';

@Injectable()
export class TwitterDownloaderService {
  @Inject(SERVICE_TOKENS.twitterDownloader) private client: ClientProxy;

  public getMediaUrls(res: Response, tweetId: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(TWITTER_PATTERNS.getMediaUrls, { tweetId }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }
}
