import { HttpService } from '@nestjs/axios';
import { createCache } from 'cache-manager';
import { of, throwError } from 'rxjs';
import { OsmReverseGeocoder } from './osm-reverse-geocoder';

const fakeHttp = (body: unknown) => {
  const calls: string[] = [];
  const headers: Record<string, unknown>[] = [];
  const http = {
    get: (url: string, config?: { headers?: Record<string, unknown> }) => {
      calls.push(url);
      headers.push(config?.headers ?? {});
      if (body instanceof Error) return throwError(() => body);
      return of({ data: body });
    },
  };
  return { http: http as unknown as HttpService, calls, headers };
};

const build = (body: unknown) => {
  const { http, calls, headers } = fakeHttp(body);
  return {
    geocoder: new OsmReverseGeocoder(createCache(), http),
    calls,
    headers,
  };
};

describe('OsmReverseGeocoder', () => {
  it('names the town rather than the postal address', async () => {
    // `display_name` is "Zaragoza, Aragón, 50001, España", which is a correct
    // answer to a different question. What belongs beside a temperature is the
    // town on its own.
    const { geocoder, calls } = build({
      name: 'Casco Histórico',
      display_name: 'Zaragoza, Aragón, 50001, España',
      address: { city: 'Zaragoza', state: 'Aragón', country_code: 'es' },
    });

    expect(await geocoder.reverse(41.65, -0.89, 'es')).toEqual({
      name: 'Zaragoza',
      country: 'ES',
    });
    // City level, and asked in the language the reading is answered in.
    expect(calls[0]).toContain('zoom=10');
    expect(calls[0]).toContain('accept-language=es');
  });

  it('falls back through the ways a place can be named', async () => {
    // Most of the world is not a city. A village keeps its own name, and
    // somewhere with no settlement in its cell is better described by the
    // district it sits in than by half a country.
    const village = build({
      address: { village: 'Utebo', country_code: 'es' },
    });
    expect((await village.geocoder.reverse(41.71, -1.02, 'en'))?.name).toBe(
      'Utebo',
    );

    const county = build({ address: { county: 'Los Monegros' } });
    expect((await county.geocoder.reverse(41.5, -0.3, 'en'))?.name).toBe(
      'Los Monegros',
    );
    // Nothing to name is a real answer — the sea, a desert — and it is not a
    // failure, so nothing is credited and the reading keeps its empty name.
    const sea = build({ address: { country_code: 'es' } });
    expect(await sea.geocoder.reverse(40, -3, 'en')).toBeUndefined();
  });

  it('identifies itself, as the usage policy requires', async () => {
    // Nominatim names a default agent as grounds for being blocked: an
    // operator with a problem needs somebody to tell.
    const { geocoder, headers } = build({ address: { city: 'Zaragoza' } });

    await geocoder.reverse(41.65, -0.89, 'en');

    expect(headers[0]['User-Agent']).toContain('canopus');
    expect(headers[0]['User-Agent']).toContain('github.com/endworks/canopus');
  });

  it('asks once per cell however many callers stand in it', async () => {
    // Places do not move, and the coordinate arrives already rounded to its
    // cell — so everyone in the same square kilometre shares one answer, and
    // the second caller costs Nominatim nothing.
    const { geocoder, calls } = build({ address: { city: 'Zaragoza' } });

    await geocoder.reverse(41.65, -0.89, 'en');
    await geocoder.reverse(41.65, -0.89, 'en');

    expect(calls).toHaveLength(1);
  });
});
