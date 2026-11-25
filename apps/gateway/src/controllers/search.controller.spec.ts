import { of } from 'rxjs';
import { SearchHit } from '@canopus/shared';
import { SearchController } from './search.controller';

const stop = (id: string, score: number): SearchHit => ({
  type: 'bus-stop',
  id,
  title: `Stop ${id}`,
  service: 'zaragoza',
  score,
});

/** Two services that answer and count how often they are asked. */
const services = (stops: SearchHit[]) => {
  const zaragoza = { send: vi.fn(() => of(stops)) };
  const agenda = { send: vi.fn(() => of([] as SearchHit[])) };
  const controller = new SearchController(agenda as any, zaragoza as any);
  return { controller, zaragoza, agenda };
};

describe('SearchController paging', () => {
  const stops = Array.from({ length: 45 }, (_, i) => stop(`${i}`, 100 - i));

  it('cuts pages from one ranked list and says where the next begins', async () => {
    const { controller } = services(stops);
    const first = await controller.search('plaza', undefined, undefined, '20');
    const second = await controller.search(
      'plaza',
      undefined,
      undefined,
      '20',
      undefined,
      String(first.meta.next),
    );
    const last = await controller.search(
      'plaza',
      undefined,
      undefined,
      '20',
      undefined,
      '40',
    );
    expect(first.data.map((h) => h.id)).toEqual(
      stops.slice(0, 20).map((h) => h.id),
    );
    expect(first.meta).toMatchObject({
      offset: 0,
      limit: 20,
      total: 45,
      next: 20,
    });
    expect(second.data[0].id).toBe('20');
    expect(last.data).toHaveLength(5);
    expect(last.meta.next).toBeNull();
  });

  it('asks the services once for a query and its pages', async () => {
    const { controller, zaragoza } = services(stops);
    await controller.search('Plaza', undefined, undefined, '20');
    await controller.search(
      'plaza',
      undefined,
      undefined,
      '20',
      undefined,
      '20',
    );
    expect(zaragoza.send).toHaveBeenCalledTimes(1);
  });

  it('does not keep an answer a service was missing from', async () => {
    const { controller, zaragoza, agenda } = services(stops);
    agenda.send.mockReturnValue(of({ statusCode: 500 } as any));
    const first = await controller.search('plaza');
    await controller.search('plaza');
    expect(first.meta.partial).toEqual(['agenda']);
    expect(zaragoza.send).toHaveBeenCalledTimes(2);
  });

  it('answers a query too short to mean anything with nothing, and asks nobody', async () => {
    const { controller, zaragoza } = services(stops);
    const answer = await controller.search('a');
    expect(answer.data).toEqual([]);
    expect(answer.meta.next).toBeNull();
    expect(zaragoza.send).not.toHaveBeenCalled();
  });
});
