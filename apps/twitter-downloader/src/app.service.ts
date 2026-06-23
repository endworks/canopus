import {
  CACHE_MANAGER,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { TwitterApi } from 'twitter-api-v2';
import { ErrorResponse, TweetMediaResults } from './app.interface';

@Injectable()
export class AppService {
  private readonly logger = new Logger('TwitterDownloaderService');

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  public async getMediaUrls(
    tweetId: string,
  ): Promise<TweetMediaResults | ErrorResponse> {
    try {
      const cache: TweetMediaResults = await this.cacheManager.get(
        `getMediaUrls/${tweetId}`,
      );
      if (cache) return cache;
      const twitterClient = new TwitterApi(process.env.TWITTER_CLIENT_TOKEN);
      const roClient = twitterClient.readOnly;
      const tweet = await roClient.v1.singleTweet(tweetId);
      const tweetUrl = `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id}`;
      const mediaUrls = [];
      tweet.extended_entities.media.forEach((media) => {
        if (media.type === 'photo') {
          mediaUrls.push(media.media_url);
        } else if (media.type === 'video' || media.type === 'animated_gif') {
          let url, bitrate;
          media.video_info.variants.forEach((variant) => {
            if (
              variant.content_type === 'video/mp4' &&
              (!bitrate || bitrate < variant.bitrate)
            ) {
              url = variant.url;
              bitrate = variant.bitrate;
            }
          });
          if (url) {
            mediaUrls.push(url);
          }
        } else {
          this.logger.log(`other media type: ${media.type}`);
        }
      });
      const response = { tweetUrl, mediaUrls };
      await this.cacheManager.set(`getMediaUrls/${tweetId}`, response);
      return response;
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
        },
        exception.message,
      );
    }
  }
}
