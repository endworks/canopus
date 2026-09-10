import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TweetMediaResults } from './app.interface';

/**
 * What the controller is for: taking the tweet's id out of the message and
 * handing it to the service.
 *
 * The fetching is the service's business and is not what this is about, so the
 * service is a stub. What this catches is what a thin controller gets wrong:
 * reading the wrong field off the payload, or answering with something other
 * than what it was given.
 */
describe('AppController', () => {
  const found: TweetMediaResults = {
    tweetUrl: 'https://x.com/i/status/1234567890',
    mediaUrls: ['https://video.twimg.com/1234567890.mp4'],
  };

  const build = async () => {
    const getMediaUrls = vi.fn(async () => found);
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: { getMediaUrls } }],
    }).compile();
    return {
      controller: app.get<AppController>(AppController),
      getMediaUrls,
    };
  };

  it('asks for the media of the tweet the message names', async () => {
    const { controller, getMediaUrls } = await build();

    await expect(
      controller.getMediaUrls({ tweetId: '1234567890' }),
    ).resolves.toBe(found);
    expect(getMediaUrls).toHaveBeenCalledWith('1234567890');
  });
});
