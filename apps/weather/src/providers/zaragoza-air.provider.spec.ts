import { HttpService } from '@nestjs/axios';
import { createCache } from 'cache-manager';
import { of, throwError } from 'rxjs';
import { AirSources } from './air-sources';
import { OpenMeteoAirProvider } from './open-meteo-air.provider';
import { ZaragozaAirProvider } from './zaragoza-air.provider';

/** Plaza del Pilar, which is inside the city and beside a station. */
const CENTRE = { latitude: 41.66, longitude: -0.88 };

/**
 * A station as the portal publishes it: the RISP envelope, a GeoJSON point
 * with longitude first, and the readings hanging off it in a list.
 */
const station = (
  title: string,
  coordinates: number[],
  mediciones: Array<{ titulo: string; valor: number | string }>,
) => ({
  id: title,
  title,
  geometry: { type: 'Point', coordinates },
  mediciones,
});

const centre = (readings: Array<{ titulo: string; valor: number | string }>) =>
  station('Centro', [-0.8797, 41.6561], readings);

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
    // NO2 at 62 is band 3 and the poorest of the four, so the grade is the
    // station's worst pollutant rather than an average of them.
    const { zaragoza } = build({
      'zaragoza.es': {
        result: [
          centre([
            { titulo: 'NO2', valor: 55 },
            { titulo: 'PM10', valor: 20 },
            { titulo: 'O3', valor: 41 },
            { titulo: 'SO2', valor: 6 },
          ]),
        ],
      },
    });

    expect(await zaragoza.read(CENTRE.latitude, CENTRE.longitude)).toBe(3);
  });

  it('reads the pollutants the portal spells out in Spanish', async () => {
    // The same five, named as the station detail names them, with a comma for
    // the decimal point. PM2.5 at 16.4 is band 3.
    const { zaragoza } = build({
      'zaragoza.es': {
        result: [
          centre([
            { titulo: 'Partículas PM2,5', valor: '16,4' },
            { titulo: 'Dióxido de nitrógeno', valor: '21' },
          ]),
        ],
      },
    });

    expect(await zaragoza.read(CENTRE.latitude, CENTRE.longitude)).toBe(3);
  });

  it('refuses a reading whose number it cannot identify', async () => {
    // Two numbers and no field that says which is the measurement: the record
    // names NO2 and could be read as 38 µg/m³ or as station 38. A plausible
    // wrong number is worse than no number, so this answers nothing and the
    // model behind it gets to speak instead.
    const { sources } = build({
      'zaragoza.es': {
        result: [station('Centro', [-0.8797, 41.6561], [])].map((base) => ({
          ...base,
          mediciones: [{ titulo: 'NO2', estacion: 38, hora: 12 } as never],
        })),
      },
      'air-quality-api.open-meteo.com': model,
    });

    const reading = await sources.read(CENTRE.latitude, CENTRE.longitude);
    expect(reading?.index).toBe(2);
    expect(reading?.source.name).toBe('Open-Meteo');
  });

  it('ignores a station too far away to be speaking about you', async () => {
    // A station in Zaragoza and a question asked from Utebo, fourteen
    // kilometres off. Inside the box, outside the range: the box is only a gate
    // and the distance is what actually decides.
    const { sources } = build({
      'zaragoza.es': { result: [centre([{ titulo: 'NO2', valor: 55 }])] },
      'air-quality-api.open-meteo.com': model,
    });

    const reading = await sources.read(41.71, -1.02);
    expect(reading?.source.name).toBe('Open-Meteo');
  });

  it('skips a station that reported nothing for one that did', async () => {
    // The nearest station is offline — present, in range, measuring nothing —
    // and the next one along is not. Ranked by distance and taken by whether
    // it answered, so the hole does not shadow the reading behind it.
    const { zaragoza } = build({
      'zaragoza.es': {
        result: [
          centre([{ titulo: 'NO2', valor: 'S/D' }]),
          station(
            'Renovales',
            [-0.8869, 41.6437],
            [{ titulo: 'PM10', valor: 130 }],
          ),
        ],
      },
    });

    expect(await zaragoza.read(CENTRE.latitude, CENTRE.longitude)).toBe(4);
  });

  it('leaves everywhere that is not Zaragoza alone', () => {
    const { zaragoza } = build({});

    expect(zaragoza.covers(41.66, -0.88)).toBe(true);
    // Madrid, Barcelona, and a point that shares the latitude but not the city.
    expect(zaragoza.covers(40.4168, -3.7038)).toBe(false);
    expect(zaragoza.covers(41.3874, 2.1686)).toBe(false);
  });

  it('costs nothing when the city feed is down', async () => {
    const { sources, calls } = build({
      'zaragoza.es': new Error('econnrefused'),
      'air-quality-api.open-meteo.com': model,
    });

    const reading = await sources.read(CENTRE.latitude, CENTRE.longitude);
    // The whole point of the fall-through: a city that cannot answer must not
    // be able to take the air away from a caller who would have had it.
    expect(reading?.index).toBe(2);
    expect(reading?.source.name).toBe('Open-Meteo');
    expect(calls.some((url) => url.includes('zaragoza.es'))).toBe(true);
  });
});

describe('AirSources', () => {
  it('prefers the city that measured it to the model that guessed', async () => {
    const { sources, calls } = build({
      'zaragoza.es': { result: [centre([{ titulo: 'NO2', valor: 55 }])] },
      'air-quality-api.open-meteo.com': model,
    });

    const reading = await sources.read(CENTRE.latitude, CENTRE.longitude);
    expect(reading?.index).toBe(3);
    expect(reading?.source.name).toBe('Ayuntamiento de Zaragoza');
    // And the model is not asked at all, rather than asked and discarded.
    expect(calls.some((url) => url.includes('open-meteo'))).toBe(false);
  });

  it('asks the city nothing about a cell it does not cover', async () => {
    const { sources, calls } = build({
      'air-quality-api.open-meteo.com': model,
    });

    const reading = await sources.read(40.4168, -3.7038);
    expect(reading?.index).toBe(2);
    expect(calls.some((url) => url.includes('zaragoza.es'))).toBe(false);
  });
});
