export class TweetMediaResults {
  /**
   * Canonical URL of the source tweet.
   * @example 'https://twitter.com/i/status/20'
   */
  tweetUrl: string;

  /**
   * Direct media URLs (photos / highest-bitrate video) found in the tweet.
   * @example ['https://pbs.twimg.com/media/abc.jpg']
   */
  mediaUrls: string[];
}
