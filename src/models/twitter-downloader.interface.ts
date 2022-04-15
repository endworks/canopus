import { ApiProperty } from '@nestjs/swagger';

export class TweetMediaResults {
  @ApiProperty()
  tweetUrl: string;

  @ApiProperty()
  mediaUrls: string[];
}
