export interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
}

export class TweetMediaPayload {
  tweetId: string;
}

export class TweetMediaResults {
  tweetUrl: string;
  mediaUrls: string[];
}
