import { HttpService } from '@nestjs/axios';
import { createCache } from 'cache-manager';
import { of, throwError } from 'rxjs';
import { AirSources } from './air-sources';
import { OpenMeteoAirProvider } from './open-meteo-air.provider';
import { ZaragozaAirProvider } from './zaragoza-air.provider';

/** Plaza del Pilar, which is inside the city and beside a station. */
const CENTRE = { latitude: 41.66, longitude: -0.88 };

/**
 * One hourly reading as the portal publishes it: the RISP envelope, the
 * station embedded in the record with its position in flat fields, and the
 * pollutant named by a nested object.
 */
const reading = (
  station: { id: string; latitud: number; longitud: number },
  contaminante: string,
  valor: number | string,
) => ({
  estacion: { title: `Estación ${station.id}`, ...station },
  contaminante: { id: contaminante, title: contaminante },
  fecha: '2026-08-28T09:00:00Z',
  valor,
});

const CENTRO = { id: '38', latitud: 41.6561, longitud: -0.8797 };
const RENOVALES = { id: '36', latitud: 41.6437, longitud: -0.8869 };

const fakeHttp = (routes: Record<string, unknown>) => {
  const calls: string[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const http = {
    get: (url: string) => {
      calls.push(url);
      const match = keys.find((key) => url.includes(key));
      const body = match ? routes[match] : undefined;
      if (body instanceof Error) return throwError(() => body);
      return of({ data: body });
    },
  };
  return { http: http as unknown as HttpService, calls };
};

const build = (routes: Record<string, unknown>) => {
  const { http, calls } = fakeHttp(routes);
  const cache = createCache();
  const zaragoza = new ZaragozaAirProvider(cache, http);
  const openMeteo = new OpenMeteoAirProvider(cache, http);
  return { zaragoza, sources: new AirSources(zaragoza, openMeteo), calls };
};

/** What Open-Meteo answers, in its own spelling. PM2.5 at 12 is band 2. */
const model = {
  current: {
    pm2_5: 12,
    pm10: 20,
    nitrogen_dioxide: 8,
    ozone: 55,
    sulphur_dioxide: 10,
  },
};

describe('ZaragozaAirProvider', () => {
  it('grades the nearest station on the European table', async () => {
    // NO2 at 55 is band 3 and the poorest of the four, so the grade is the
    // station's worst pollutant rather than an average of them.
    const { zaragoza } = build({
      'zaragoza.es': {
        result: [
          reading(CENTRO, 'NO2', 55),
          reading(CENTRO, 'PM10', 20),
          reading(CENTRO, 'O3', 41),
          reading(CENTRO, 'SO2', 6),
        ],
      },
    });

    expect(await zaragoza.read(CENTRE.latitude, CENTRE.longitude)).toBe(3);
  });

  it('reads the pollutants the portal spells out in Spanish', async () => {
    // The same five, named as the feed names them, with a comma for the
    // decimal point. PM2.5 at 16,4 is band 3.
    const { zaragoza } = build({
      'zaragoza.es': {
        result: [
          reading(CENTRO, 'Partículas PM2,5', '16,4'),
          reading(CENTRO, 'Dióxido de nitrógeno', '21'),
        ],
      },
    });

    expect(await zaragoza.read(CENTRE.latitude, CENTRE.longitude)).toBe(3);
  });

  it('groups a document that speaks for the whole network by station', async () => {
    // One call, every station, and the records interleaved as the feed sends
    // them. Grouping by the station's own id is what makes the un-parameterised
    // call worth making — and Renovales' PM10 must not land on Centro.
    const { zaragoza } = build({
      'zaragoza.es': {
        result: [
          reading(RENOVALES, 'PM10', 130),
          reading(CENTRO, 'NO2', 21),
          reading(RENOVALES, 'NO2', 12),
        ],
      },
    });

    // Centro is nearest and holds only its own NO2, which is band 2 — not the
    // band 4 it would be if Renovales' PM10 had leaked into it.
    expect(await zaragoza.read(CENTRE.latitude, CENTRE.longitude)).toBe(2);
  });

  it('refuses a reading whose number it cannot identify', async () => {
    // The pollutant is named but no field says which number is the measurement.
    // A plausible wrong value is worse than none, so this answers nothing and
    // the model behind it speaks instead.
    const { sources } = build({
      'zaragoza.es': {
        result: [
          {
            estacion: { title: 'Centro', ...CENTRO },
            contaminante: { id: 'NO2', title: 'NO2' },
            fecha: '2026-08-28T09:00:00Z',
            altitud: 199,
          },
        ],
      },
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await sources.read(CENTRE.latitude, CENTRE.longitude);
    expect(answer?.index).toBe(2);
    expect(answer?.source.name).toBe('Open-Meteo');
  });

  it('ignores a station too far away to be speaking about you', async () => {
    // A station in Zaragoza and a question asked from Utebo, fourteen
    // kilometres off. Inside the box, outside the range: the box is only a gate
    // and the distance is what actually decides.
    const { sources } = build({
      'zaragoza.es': { result: [reading(CENTRO, 'NO2', 55)] },
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await sources.read(41.71, -1.02);
    expect(answer?.source.name).toBe('Open-Meteo');
  });

  it('skips a station that reported nothing for one that did', async () => {
    // The nearest station is offline — present, in range, measuring nothing —
    // and the next one along is not. Ranked by distance and taken by whether it
    // graded, so the hole does not shadow the reading behind it.
    const { zaragoza } = build({
      'zaragoza.es': {
        result: [
          reading(CENTRO, 'NO2', 'S/D'),
          reading(RENOVALES, 'PM10', 130),
        ],
      },
    });

    expect(await zaragoza.read(CENTRE.latitude, CENTRE.longitude)).toBe(4);
  });

  it('leaves everywhere that is not Zaragoza alone', () => {
    const { zaragoza } = build({});

    expect(zaragoza.covers(41.66, -0.88)).toBe(true);
    // Madrid, and a point that shares the latitude but not the city.
    expect(zaragoza.covers(40.4168, -3.7038)).toBe(false);
    expect(zaragoza.covers(41.3874, 2.1686)).toBe(false);
  });

  it('costs nothing when the city feed is down', async () => {
    const { sources, calls } = build({
      'zaragoza.es': new Error('econnrefused'),
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await sources.read(CENTRE.latitude, CENTRE.longitude);
    // The whole point of the fall-through: a city that cannot answer must not
    // take the air away from a caller who would have had it.
    expect(answer?.index).toBe(2);
    expect(answer?.source.name).toBe('Open-Meteo');
    expect(calls.some((url) => url.includes('zaragoza.es'))).toBe(true);
  });
});

describe('AirSources', () => {
  it('prefers the city that measured it to the model that guessed', async () => {
    const { sources, calls } = build({
      'zaragoza.es': { result: [reading(CENTRO, 'NO2', 55)] },
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await sources.read(CENTRE.latitude, CENTRE.longitude);
    expect(answer?.index).toBe(3);
    expect(answer?.source.name).toBe('Ayuntamiento de Zaragoza');
    // And the model is not asked at all, rather than asked and discarded.
    expect(calls.some((url) => url.includes('open-meteo'))).toBe(false);
  });

  it('asks the city nothing about a cell it does not cover', async () => {
    const { sources, calls } = build({
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await sources.read(40.4168, -3.7038);
    expect(answer?.index).toBe(2);
    expect(calls.some((url) => url.includes('zaragoza.es'))).toBe(false);
  });
});
