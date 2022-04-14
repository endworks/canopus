import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { TwitterDownloaderService } from 'src/services/twitter-downloader.service';
import { TweetMediaResults } from 'src/models/twitter-downloader.interface';

@Controller('twitter-downloader')
@ApiTags('twitter-downloader')
export class RAEController {
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
  async termSearch(
    @Res({ passthrough: true }) res: Response,
    @Param('tweetId') tweetId: string,
  ) {
    return this.twitterDownloaderService.getMediaUrls(res, tweetId);
  }
}
