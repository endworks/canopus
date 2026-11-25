import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { CacheKind, CachePolicyInterceptor, POLICIES } from './cache-policy';

const call = (
  interceptor: CachePolicyInterceptor,
  kind: CacheKind | undefined,
  url: string,
  answer: () => { status: number; body: unknown },
) => {
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string) => (headers[name] = value),
  };
  const handled = vi.fn(() => {
    const { status, body } = answer();
    response.statusCode = status;
    return of(body);
  });
  const context = {
    getType: () => 'http',
    getHandler: () => kind,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl: url }),
      getResponse: () => response,
    }),
  } as any;
  return firstValueFrom(
    interceptor.intercept(context, { handle: handled }),
  ).then((body) => ({ body, headers, handled }));
};

/** A reflector that reads the kind straight off the fake handler. */
const reflector = {
  getAllAndOverride: (_key: string, [handler]: unknown[]) => handler,
} as unknown as Reflector;

describe('CachePolicyInterceptor', () => {
  it('stamps the kind’s Cache-Control', async () => {
    const interceptor = new CachePolicyInterceptor(reflector);
    const { headers } = await call(
      interceptor,
      'live',
      '/zgz/bus/stations/720',
      () => ({
        status: 200,
        body: {},
      }),
    );
    expect(headers['Cache-Control']).toBe(POLICIES.live.header);
  });

  it('answers a repeat of a static route from memory', async () => {
    const interceptor = new CachePolicyInterceptor(reflector);
    let n = 0;
    const answer = () => ({ status: 200, body: { n: ++n } });
    const first = await call(
      interceptor,
      'static',
      '/zgz/bus/stations',
      answer,
    );
    const second = await call(
      interceptor,
      'static',
      '/zgz/bus/stations',
      answer,
    );
    expect(first.body).toEqual({ n: 1 });
    expect(second.body).toEqual({ n: 1 });
    expect(second.handled).not.toHaveBeenCalled();
  });

  it('keeps each URL apart, query included', async () => {
    const interceptor = new CachePolicyInterceptor(reflector);
    let n = 0;
    const answer = () => ({ status: 200, body: { n: ++n } });
    await call(interceptor, 'daily', '/zgz/agenda/v1/feed?lang=es', answer);
    const english = await call(
      interceptor,
      'daily',
      '/zgz/agenda/v1/feed?lang=en',
      answer,
    );
    expect(english.body).toEqual({ n: 2 });
  });

  it('never keeps a failure or a live answer', async () => {
    const interceptor = new CachePolicyInterceptor(reflector);
    let n = 0;
    await call(interceptor, 'static', '/zgz/bus/lines/99', () => ({
      status: 404,
      body: { n: ++n },
    }));
    const again = await call(
      interceptor,
      'static',
      '/zgz/bus/lines/99',
      () => ({
        status: 200,
        body: { n: ++n },
      }),
    );
    expect(again.body).toEqual({ n: 2 });
    await call(interceptor, 'live', '/zgz/bus/stations/720', () => ({
      status: 200,
      body: { n: ++n },
    }));
    const live = await call(
      interceptor,
      'live',
      '/zgz/bus/stations/720',
      () => ({
        status: 200,
        body: { n: ++n },
      }),
    );
    expect(live.body).toEqual({ n: 4 });
  });

  it('leaves a route without a kind alone', async () => {
    const interceptor = new CachePolicyInterceptor(reflector);
    const { headers } = await call(
      interceptor,
      undefined,
      '/push/devices',
      () => ({
        status: 200,
        body: {},
      }),
    );
    expect(headers['Cache-Control']).toBeUndefined();
  });
});
