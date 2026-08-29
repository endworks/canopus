import { HttpService } from '@nestjs/axios';
import { createCache } from 'cache-manager';
import { of, throwError } from 'rxjs';
import { AirSources } from './air-sources';
import { OpenMeteoAirProvider } from './open-meteo-air.provider';
import {
  fromUtm,
  MAX_AGE_HOURS,
  Observation,
  StationRecord,
  ZaragozaAirProvider,
} from './zaragoza-air.provider';

/** Plaza del Pilar, which is inside the city and beside a station. */
const CENTRE = { latitude: 41.6563, longitude: -0.8781 };

/**
 * Two of the eight, with the projected coordinates the feed actually carries.
 *
 * Copied from `listado.json` rather than invented, because the coordinates are
 * the one part of this the parser transforms rather than reads: a made-up pair
 * would test the arithmetic against itself. Centro is about 400 m from Plaza
 * del Pilar and Renovales about 2 km, so both are in range and Centro is
 * nearer.
 */
const CENTRO = { id: 10, idSparql: 38, title: 'Centro' };
const CENTRO_UTM = [676330.4048585793, 4613449.25781236];
const RENOVALES = { id: 8, idSparql: 36, title: 'Renovales' };
const RENOVALES_UTM = [675559.2751592833, 4611716.269593586];

/**
 * The hour the feed is publishing, in the city's own wall time.
 *
 * Written without a zone exactly as the portal writes it, and derived from now
 * so the freshness rule sees a current document however long this suite lives.
 */
const hourInMadrid = (hoursAgo = 0): string =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .format(new Date(Date.now() - hoursAgo * 60 * 60 * 1000))
    .replace(' ', 'T');

/** One reading, as a station carries it in `observation`. */
const observation = (
  magnitud: string,
  value: number | string,
  hoursAgo = 0,
): Observation => ({
  publicationDate: hourInMadrid(hoursAgo),
  value: String(value),
  magnitud,
  estado: 'Tiempo real',
  periodo: 'Horario',
});

/** One station, as `listado.json` publishes it. */
const station = (
  who: { id: number; idSparql: number; title: string },
  coordinates: number[],
  observations: Observation[],
): StationRecord => ({
  ...who,
  geometry: { type: 'Point', coordinates },
  observation: observations,
});

const listado = (...result: StationRecord[]) => ({
  totalCount: result.length,
  start: 0,
  rows: result.length,
  result,
});

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

/**
 * The air as the service takes it: what is measured here, else what is
 * modelled. The two are asked separately in earnest, because the service has
 * a weather provider to decide about in between — see `AirSources`.
 */
const best = (sources: AirSources, latitude: number, longitude: number) =>
  sources
    .measured(latitude, longitude)
    .then((measured) => measured ?? sources.modelled(latitude, longitude));

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

describe('fromUtm', () => {
  it('puts the stations where the city says they stand', () => {
    // The published position of Centro, on Calle Albareda, to five decimals —
    // which is about a metre. The check that matters is the datum: reading
    // these as ED50 instead of ETRS89 lands 240 m north-west of the station.
    const centro = fromUtm(CENTRO_UTM[0], CENTRO_UTM[1]);
    expect(centro.latitude).toBeCloseTo(41.65329, 4);
    expect(centro.longitude).toBeCloseTo(-0.88237, 4);

    const renovales = fromUtm(RENOVALES_UTM[0], RENOVALES_UTM[1]);
    expect(renovales.latitude).toBeCloseTo(41.63787, 4);
    expect(renovales.longitude).toBeCloseTo(-0.89214, 4);
  });
});

describe('ZaragozaAirProvider', () => {
  it('grades the nearest station on the European table', async () => {
    // NO2 at 55 is band 3 and the poorest of the four, so the grade is the
    // station's worst pollutant rather than an average of them.
    const { zaragoza } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [
          observation('NO2', 55),
          observation('PM10', 20),
          observation('O3', 41),
          observation('SO2', 6),
        ]),
      ),
    });

    expect(
      (await zaragoza.read(CENTRE.latitude, CENTRE.longitude))?.index,
    ).toBe(3);
  });

  it('reads the pollutants however the portal spells them', async () => {
    // `listado.json` writes them plainly, but the aliases also carry the
    // spellings the other endpoints in the same service use. PM2.5 at 16,4 is
    // band 3.
    const { zaragoza } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [
          observation('Partículas PM2,5', '16,4'),
          observation('Dióxido de nitrógeno', '21'),
        ]),
      ),
    });

    expect(
      (await zaragoza.read(CENTRE.latitude, CENTRE.longitude))?.index,
    ).toBe(3);
  });

  it('keeps each station to its own readings', async () => {
    // One call, every station, each carrying its own `observation` array.
    // Renovales' PM10 must not land on Centro.
    const { zaragoza } = build({
      'zaragoza.es': listado(
        station(RENOVALES, RENOVALES_UTM, [observation('PM10', 130)]),
        station(CENTRO, CENTRO_UTM, [observation('NO2', 21)]),
      ),
    });

    // Centro is nearest and holds only its own NO2, which is band 2 — not the
    // band 4 it would be if Renovales' PM10 had leaked into it.
    expect(
      (await zaragoza.read(CENTRE.latitude, CENTRE.longitude))?.index,
    ).toBe(2);
  });

  it('takes each pollutant from its newest hour', async () => {
    // A station does not report every pollutant in every hour. NO2 came in
    // this hour at band 2; PM10 last hour at band 4 and not since. Keeping
    // only the newest hour would throw the PM10 away and under-grade the air.
    const { zaragoza } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [
          observation('NO2', 21),
          observation('PM10', 130, 1),
        ]),
      ),
    });

    expect(
      (await zaragoza.read(CENTRE.latitude, CENTRE.longitude))?.index,
    ).toBe(4);
  });

  it('prefers the newer of two readings of the same pollutant', async () => {
    // The same hour's document carries this hour and last. Order in the array
    // is the feed's business, so the timestamp decides: NO2 is 21, band 2.
    const { zaragoza } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [
          observation('NO2', 21),
          observation('NO2', 130, 1),
        ]),
      ),
    });

    expect(
      (await zaragoza.read(CENTRE.latitude, CENTRE.longitude))?.index,
    ).toBe(2);
  });

  it('refuses a reading whose number is not a number', async () => {
    // `S/D` is what a station mid-calibration publishes. A plausible wrong
    // value is worse than none, so this answers nothing and the model behind
    // it speaks instead.
    const { sources } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [observation('NO2', 'S/D')]),
      ),
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await best(sources, CENTRE.latitude, CENTRE.longitude);
    expect(answer?.index).toBe(2);
    expect(answer?.source.name).toBe('Open-Meteo');
  });

  it('drops a station with no position rather than assuming one', async () => {
    // Every station in the live feed carries `geometry`. One that did not
    // would otherwise be treated as standing wherever the caller does, which
    // is the one way this file could confidently answer about the wrong city.
    const { sources } = build({
      'zaragoza.es': listado({
        ...CENTRO,
        observation: [observation('NO2', 55)],
      }),
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await best(sources, CENTRE.latitude, CENTRE.longitude);
    expect(answer?.source.name).toBe('Open-Meteo');
  });

  it('refuses a document the network stopped updating', async () => {
    // Parses, grades, and is hours stale. Being measured is what ranks this
    // source above the model, and a reading from last Tuesday has stopped
    // being a measurement of the air now.
    const { sources } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [
          observation('NO2', 55, MAX_AGE_HOURS + 1),
        ]),
      ),
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await best(sources, CENTRE.latitude, CENTRE.longitude);
    expect(answer?.index).toBe(2);
    expect(answer?.source.name).toBe('Open-Meteo');
  });

  it('ignores a station too far away to be speaking about you', async () => {
    // A station in Zaragoza and a question asked from Utebo, fourteen
    // kilometres off. Inside the box, outside the range: the box is only a gate
    // and the distance is what actually decides.
    const { sources } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [observation('NO2', 55)]),
      ),
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await best(sources, 41.71, -1.02);
    expect(answer?.source.name).toBe('Open-Meteo');
  });

  it('skips a station that reported nothing for one that did', async () => {
    // The nearest station is offline — present, in range, measuring nothing —
    // and the next one along is not. Ranked by distance and taken by whether it
    // graded, so the hole does not shadow the reading behind it.
    const { zaragoza } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [observation('NO2', 'S/D')]),
        station(RENOVALES, RENOVALES_UTM, [observation('PM10', 130)]),
      ),
    });

    expect(
      (await zaragoza.read(CENTRE.latitude, CENTRE.longitude))?.index,
    ).toBe(4);
  });

  it('says what the reuse terms require, with the hour it is about', async () => {
    // Ley 37/2007 wants two things beyond the credit: that the city be said
    // not to endorse the reuse, and the date the data was last updated. Both
    // in `disclaimer`, and the date is the station's own hour rather than the
    // response's `lastUpdated`, which belongs to whoever answered the weather.
    const { zaragoza } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [observation('NO2', 55)]),
      ),
    });

    const graded = await zaragoza.read(CENTRE.latitude, CENTRE.longitude);
    expect(graded?.disclaimer).toContain(
      'no participa, patrocina ni apoya esta reutilización',
    );
    expect(graded?.disclaimer).toContain('Datos actualizados el');
    // The hour the reading carries, on the city's clock — not the moment the
    // document happened to be served.
    expect(graded?.disclaimer).toContain(
      new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date()),
    );
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

    const answer = await best(sources, CENTRE.latitude, CENTRE.longitude);
    // The whole point of the fall-through: a city that cannot answer must not
    // take the air away from a caller who would have had it.
    expect(answer?.index).toBe(2);
    expect(answer?.source.name).toBe('Open-Meteo');
    expect(calls.some((url) => url.includes('zaragoza.es'))).toBe(true);
  });

  it('asks for the whole network in one call', async () => {
    const { zaragoza, calls } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [observation('NO2', 55)]),
      ),
    });

    await zaragoza.read(CENTRE.latitude, CENTRE.longitude);
    expect(calls).toHaveLength(1);
    // Not `estacion/horaria.json`, which answers 400 without a station id and
    // one station at a time with one.
    expect(calls[0]).toContain('calidad-aire/listado.json');
    expect(calls[0]).not.toContain('estacion=');
  });
});

describe('AirSources', () => {
  it('answers from the city that measured it, asking no model', async () => {
    // The two halves are asked separately so a caller can act on the first:
    // where an instrument answered, nobody else is worth asking, and that is
    // what lets the service skip the weather provider's own air entirely.
    const { sources, calls } = build({
      'zaragoza.es': listado(
        station(CENTRO, CENTRO_UTM, [observation('NO2', 55)]),
      ),
      'air-quality-api.open-meteo.com': model,
    });

    const answer = await sources.measured(CENTRE.latitude, CENTRE.longitude);
    expect(answer?.index).toBe(3);
    expect(answer?.source.name).toBe('Ayuntamiento de Zaragoza');
    // And the model is not asked at all, rather than asked and discarded.
    expect(calls.some((url) => url.includes('open-meteo'))).toBe(false);
  });

  it('asks the city nothing about a cell it does not cover', async () => {
    const { sources, calls } = build({
      'air-quality-api.open-meteo.com': model,
    });

    // Nothing measured reaches Madrid, and finding that out costs no request:
    // `covers` is a bounds check.
    expect(await sources.measured(40.4168, -3.7038)).toBeUndefined();
    expect(calls).toHaveLength(0);

    const answer = await sources.modelled(40.4168, -3.7038);
    expect(answer?.index).toBe(2);
    expect(calls.some((url) => url.includes('zaragoza.es'))).toBe(false);
  });
});
