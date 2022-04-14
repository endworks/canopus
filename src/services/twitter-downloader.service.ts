import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { Response } from 'express';

@Injectable()
export class TwitterDownloaderService {
  @Inject('TWITTER_DOWNLOADER_SERVICE') private client: ClientProxy;

  public getMediaUrls(res: Response, tweetId: number): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('getMediaUrls', { tweetId }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }
}
