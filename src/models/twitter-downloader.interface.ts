import { ApiProperty } from '@nestjs/swagger';

export class TweetMediaResults {
  @ApiProperty()
  mediaUrls: string[];
}
