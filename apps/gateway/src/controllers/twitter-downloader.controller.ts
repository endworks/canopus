import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TwitterDownloaderService } from 'src/services/twitter-downloader.service';
import { TweetMediaResults } from 'src/models/twitter-downloader.interface';

@ApiTags('Twitter downloader')
@Controller('twdl')
export class TwitterDownloaderController {
  constructor(
    private readonly twitterDownloaderService: TwitterDownloaderService,
  ) {}

  @Get('getMediaUrls/:tweetId')
  @ApiOperation({ summary: 'Get media urls by tweet ID' })
  @ApiParam({ name: 'tweetId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return media urls by tweet ID',
    type: TweetMediaResults,
  })
  async termSearch(@Param('tweetId') tweetId: string) {
    return this.twitterDownloaderService.getMediaUrls(tweetId);
  }
}
