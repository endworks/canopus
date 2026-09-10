import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SearchResponse } from './app.interface';

/**
 * What the controller is for: taking the term out of the message and handing
 * it to the service.
 *
 * That is the whole of it — the dictionary itself is the service's business
 * and is covered where it lives — so the service is a stub here. What this
 * catches is the thing a thin controller actually gets wrong: reading the
 * wrong field off the payload, or answering with something other than what it
 * was given.
 */
describe('AppController', () => {
  const found: SearchResponse = {
    term: 'zierzo',
    etymology: 'Del lat. cercĭus.',
    meanings: [],
    complexForms: [],
    expressions: [],
  };

  const build = async () => {
    const search = vi.fn(async () => found);
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: { search } }],
    }).compile();
    return { controller: app.get<AppController>(AppController), search };
  };

  it('looks up the term the message carries', async () => {
    const { controller, search } = await build();

    await expect(controller.search({ term: 'zierzo' })).resolves.toBe(found);
    expect(search).toHaveBeenCalledWith('zierzo');
  });
});
