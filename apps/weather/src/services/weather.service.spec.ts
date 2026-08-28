import { generateKeyPairSync } from 'node:crypto';
import { HttpService } from '@nestjs/axios';
import { HttpException } from '@nestjs/common';
import { createCache } from 'cache-manager';
import { of, throwError } from 'rxjs';
import { AppleWeatherProvider } from '../providers/apple-weather.provider';
import { MeteoAlarmProvider } from '../providers/meteoalarm.provider';
import { AirSources } from '../providers/air-sources';
import { OpenMeteoAirProvider } from '../providers/open-meteo-air.provider';
import { ZaragozaAirProvider } from '../providers/zaragoza-air.provider';
import { OpenMeteoGeocoder } from '../providers/open-meteo-geocoder';
import { OpenMeteoUvProvider } from '../providers/open-meteo-uv.provider';
import { RegionAtlas } from '../providers/region-atlas';
import { OpenWeatherProvider } from '../providers/open-weather.provider';
import { ClientKeys } from '../providers/client-keys';
import { WeatherProvider } from '../providers/weather-provider';
import { WeatherService } from './weather.service';

/** The wording MeteoAlarm requires every redistributor to publish, verbatim. */
const METEOALARM_DELAY =
  'Time delays between this website and the www.meteoalarm.org website are ' +
  'possible. For the most up-to-date awareness information as published by ' +
  'the participating National Meteorological and Hydrological Services, ' +
  'please refer to www.meteoalarm.org.';

const HOUR = 3600;
// Relative to the clock the test actually runs on: `uvProtectionUntil` is the
// first hour ahead of now, so a fixed timestamp would stop meaning "ahead".
const NOW = Math.floor(Date.now() / 1000);

const current = (name = 'Zaragoza', country = 'ES') => ({
  weather: [{ id: 800, icon: '01d', description: 'cielo claro' }],
  main: { temp: 24.3, feels_like: 23.8, humidity: 41, pressure: 1014 },
  wind: { speed: 4.6, deg: 310 },
  clouds: { all: 0 },
  sys: { sunrise: NOW - 6 * HOUR, sunset: NOW + 7 * HOUR, country },
  dt: NOW,
  timezone: 7200,
  name,
});

const forecast = {
  list: [
    {
      dt: NOW + 3 * HOUR,
      main: { temp: 31.2, feels_like: 30.4 },
      weather: [{ id: 802, icon: '03d', description: 'nubes dispersas' }],
      pop: 0.2,
    },
    {
      dt: NOW + 6 * HOUR,
      main: { temp: 18.4, feels_like: 18 },
      weather: [{ id: 800, icon: '01n', description: 'cielo claro' }],
    },
  ],
};

// Concentrations rather than OpenWeather's own `aqi`: the index is computed
// from these now, by the EEA's table. PM2.5 at 12 is the poorest of the five
// here — band 2, Fair — and the rest sit below it, which is what makes this
// fixture a test of the poorest-pollutant rule rather than of one number.
const air = {
  list: [
    {
      components: { pm2_5: 12, pm10: 20, no2: 8, o3: 55, so2: 10 },
    },
  ],
};

const uvBody = {
  current: { uv_index: 7.2 },
  hourly: {
    time: [NOW, NOW + HOUR, NOW + 2 * HOUR],
    uv_index: [7.2, 4.1, 1.2],
  },
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** One CAP info block, in the shape MeteoAlarm actually publishes. */
// ES107 is the region the atlas puts 41.6,-0.9 in, and ES191 is the Tarragona
// coast three hundred kilometres away — the pair is what makes narrowing
// visible rather than assumed.
const ZARAGOZA = { desc: 'Ribera del Ebro de Zaragoza', code: 'ES107' };
const TARRAGONA = { desc: 'Litoral norte de Tarragona', code: 'ES191' };

const info = (
  language: string,
  event: string,
  extra: Record<string, unknown> = {},
  where = ZARAGOZA,
) => ({
  language,
  event,
  headline: `${event}. ${where.desc}`,
  description: 'Precipitacion acumulada en 12 horas: 180 mm.',
  instruction: 'Tome medidas preventivas.',
  severity: 'Extreme',
  certainty: 'Observed',
  urgency: 'Immediate',
  onset: iso(NOW - HOUR),
  expires: iso(NOW + HOUR),
  senderName: 'AEMET. Agencia Estatal de Meteorologia',
  web: 'https://www.aemet.es/es/eltiempo/prediccion/avisos',
  area: [
    {
      areaDesc: where.desc,
      geocode: [{ value: where.code, valueName: 'EMMA_ID' }],
    },
  ],
  parameter: [
    { value: '4; red; Extreme', valueName: 'awareness_level' },
    { value: '10; Rain', valueName: 'awareness_type' },
  ],
  ...extra,
});

const warning = (
  identifier: string,
  infos: unknown[],
  extra: Record<string, unknown> = {},
) => ({
  alert: {
    identifier,
    status: 'Actual',
    scope: 'Public',
    msgType: 'Alert',
    info: infos,
    ...extra,
  },
});

const orangeSnow = {
  severity: 'Severe',
  parameter: [
    { value: '3; orange; Severe', valueName: 'awareness_level' },
    { value: '2; snow-ice', valueName: 'awareness_type' },
  ],
};

const yellowWind = {
  severity: 'Moderate',
  parameter: [
    { value: '2; yellow; Moderate', valueName: 'awareness_level' },
    { value: '1; Wind', valueName: 'awareness_type' },
  ],
};

const alerts = {
  warnings: [
    warning('wind-now', [
      info('en-GB', 'Moderate wind warning', yellowWind),
      info('es-ES', 'Aviso de viento de nivel amarillo', yellowWind),
    ]),
    warning('rain-now', [
      info('en-GB', 'Extreme rain warning'),
      info('es-ES', 'Aviso de lluvias de nivel rojo'),
    ]),
    warning('rain-lapsed', [
      info('en-GB', 'Extreme rain warning', { expires: iso(NOW - HOUR) }),
    ]),
    warning('snow-replaced', [info('en-GB', 'Snow warning')]),
    warning('rain-coast', [
      info('en-GB', 'Extreme coastal rain warning', {}, TARRAGONA),
    ]),
    warning(
      'snow-update',
      [info('en-GB', 'Updated snow warning', orangeSnow)],
      {
        msgType: 'Update',
        references: `http://www.aemet.es,snow-replaced,${iso(NOW - HOUR)}`,
      },
    ),
  ],
};

const httpError = (status: number) => {
  const error: Error & {
    isAxiosError: boolean;
    response: { status: number };
  } = Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });
  return error;
};

/**
 * A fake HttpService that answers by URL fragment and counts what it was asked.
 * Matched longest-first so `/weather` cannot swallow a route that contains it.
 */
const fakeHttp = (routes: Record<string, unknown>) => {
  const calls: string[] = [];
  const headers: Record<string, unknown>[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const http = {
    get: (url: string, config?: { headers?: Record<string, unknown> }) => {
      calls.push(url);
      headers.push(config?.headers ?? {});
      const match = keys.find((key) => url.includes(key));
      const body = match ? routes[match] : undefined;
      if (body instanceof Error) return throwError(() => body);
      return of({ data: body });
    },
  };
  return { http: http as unknown as HttpService, calls, headers };
};

/** The URL a given upstream was asked with, whatever order it went out in. */
const asked = (calls: string[], fragment: string) =>
  calls.find((url) => url.includes(fragment));

const build = (routes: Record<string, unknown>, keys: string[] = []) => {
  const { http, calls, headers } = fakeHttp(routes);
  const cache = createCache();
  const provider = new OpenWeatherProvider(cache, http);
  const apple = new AppleWeatherProvider(cache, http);
  const uv = new OpenMeteoUvProvider(cache, http);
  const air = new AirSources(
    new ZaragozaAirProvider(cache, http),
    new OpenMeteoAirProvider(cache, http),
  );
  const meteoalarm = new MeteoAlarmProvider(cache, http);
  const service = new WeatherService(
    new Map<string, WeatherProvider>([
      [provider.info.id, provider],
      [apple.info.id, apple],
    ]),
    uv,
    air,
    meteoalarm,
    new RegionAtlas(),
    new OpenMeteoGeocoder(cache, http),
    new ClientKeys(keys),
  );
  return { service, calls, headers };
};

/** The headers a given upstream was asked with. */
const sentTo = (
  calls: string[],
  headers: Record<string, unknown>[],
  fragment: string,
) => headers[calls.findIndex((url) => url.includes(fragment))];

// The city's own air network, answering with no stations — so the tests below
// that are about something else keep the air they always had, from whoever the
// provider is. The station that does answer has a test of its own.
const noStations = { result: [] };

const routes = {
  'calidad-aire/estacion.json': noStations,
  '/data/2.5/weather': current(),
  '/data/2.5/forecast': forecast,
  '/air_pollution': air,
  '/geo/1.0/direct': [
    { name: 'Madrid', country: 'ES', lat: 40.4168, lon: -3.7038 },
  ],
  'open-meteo.com': uvBody,
  'feeds.meteoalarm.org': alerts,
};

describe('getWeather', () => {
  it('rounds coordinates to a cell and reports the cell it answered for', async () => {
    const { service, calls } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6488,
      longitude: -0.8891,
    });

    // 41.6488, -0.8891 to the hundredth: a cell a little over a kilometre
    // across rather than the eleven it used to be.
    expect(reading.location.latitude).toBe(41.65);
    expect(reading.location.longitude).toBe(-0.89);
    expect(asked(calls, '/data/2.5/weather')).toContain('lat=41.65&lon=-0.89');
  });

  it('takes the range from the forecast, not from the observation', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
    });

    expect(reading.current.high).toBe(31.2);
    expect(reading.current.low).toBe(18.4);
    expect(reading.forecast).toHaveLength(2);
    expect(reading.forecast[1].precipitation).toBe(0);
  });

  it('dates the reading by the observation rather than by the request', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
    });

    expect(reading.lastUpdated).toBe(new Date(NOW * 1000).toISOString());
  });

  it('serves a second caller in the same cell without asking again', async () => {
    const { service, calls } = build(routes);
    const question = { apiKey: 'key', latitude: 41.64, longitude: -0.88 };

    await service.getWeather(question);
    await service.getWeather({ ...question, apiKey: 'someone-elses-key' });

    // Four upstreams for a cell in Zaragoza: the weather, the forecast,
    // OpenWeather's own air, and the city's network — which is asked because
    // a station would beat all three, and which has nothing here. Asked once
    // each: what the second caller costs is the point, and it is nothing.
    expect(calls).toHaveLength(4);
  });

  it('lets the city that measured the air overrule the provider that modelled it', async () => {
    // OpenWeather carries its own pollutants, and they are modelled off the
    // same continental runs as everyone else's. A station a few streets from
    // the cell is a different kind of answer, so it wins — and the credit
    // moves with it, because the reader is owed the source that actually
    // measured the number they are looking at.
    const { service } = build({
      ...routes,
      'calidad-aire/estacion.json': {
        result: [
          {
            id: 'Centro',
            title: 'Centro',
            geometry: { type: 'Point', coordinates: [-0.8797, 41.6561] },
            mediciones: [{ titulo: 'PM10', valor: 130 }],
          },
        ],
      },
    });

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6561,
      longitude: -0.8797,
    });

    // PM10 at 130 is band 4, against the band 2 OpenWeather's own fixture
    // grades to — so this is the station's number, not the model's.
    expect(reading.current.airQuality).toBe(4);
    expect(reading.attribution).toEqual([
      {
        name: 'OpenWeather',
        url: 'https://openweathermap.org/',
        licence: 'https://creativecommons.org/licenses/by-sa/4.0/',
        // No longer credited for the air it was asked for and did answer:
        // somebody else's number is the one in the payload.
        provides: ['weather', 'forecast'],
      },
      {
        name: 'Ayuntamiento de Zaragoza',
        url: 'https://www.zaragoza.es/sede/portal/medioambiente/calidad-aire/',
        licence: 'https://www.zaragoza.es/ciudad/risp/decalogo.htm',
        // The wording the city's reuse terms name, in its own language.
        notice: 'Origen de los datos: Ayuntamiento de Zaragoza',
        provides: ['airQuality'],
      },
    ]);
  });

  it('resolves a place name and keeps the name it was asked about', async () => {
    const { service, calls } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      location: 'Madrid',
    });

    expect(reading.location).toMatchObject({
      name: 'Madrid',
      country: 'ES',
      latitude: 40.42,
      longitude: -3.7,
    });
    expect(asked(calls, '/geo/1.0/direct')).toBeDefined();
  });

  it('credits every source, and only for what it answered', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      location: 'Madrid',
      includeUv: true,
    });

    expect(reading.attribution).toEqual([
      {
        name: 'OpenWeather',
        url: 'https://openweathermap.org/',
        licence: 'https://creativecommons.org/licenses/by-sa/4.0/',
        provides: ['weather', 'forecast', 'airQuality', 'geocoding'],
      },
      {
        name: 'Open-Meteo',
        url: 'https://open-meteo.com/',
        licence: 'https://creativecommons.org/licenses/by/4.0/',
        notice: 'Weather data by Open-Meteo.com',
        provides: ['uv'],
      },
    ]);
  });

  it('leaves the UV index out until it is asked for', async () => {
    const { service, calls } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
    });

    expect(reading.current.uv).toBeUndefined();
    expect(reading.attribution).toHaveLength(1);
    expect(calls.some((url) => url.includes('open-meteo'))).toBe(false);
  });

  it('says when the UV index drops back under the protection band', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeUv: true,
    });

    expect(reading.current.uv).toBe(7.2);
    expect(reading.current.uvProtectionUntil).toBe(NOW + 2 * HOUR);
  });

  it('costs the UV row rather than the temperature when the second service is down', async () => {
    const { service } = build({ ...routes, 'open-meteo.com': httpError(503) });

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeUv: true,
    });

    expect(reading.current.temperature).toBe(24.3);
    expect(reading.current.uv).toBeUndefined();
    expect(reading.attribution).toHaveLength(1);
  });

  it('lists the warnings in force, most severe first', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    });

    expect(reading.alerts?.map((alert) => alert.event)).toEqual([
      'Extreme rain warning',
      'Updated snow warning',
      'Moderate wind warning',
    ]);
    expect(reading.alerts?.[0]).toMatchObject({
      id: 'rain-now',
      severity: 'Extreme',
      level: 'red',
      awareness: 'Rain',
      urgency: 'Immediate',
      certainty: 'Observed',
      onset: NOW - HOUR,
      expires: NOW + HOUR,
      areas: ['Ribera del Ebro de Zaragoza'],
      regions: [{ code: 'ES107', type: 'EMMA_ID' }],
      sender: 'AEMET. Agencia Estatal de Meteorologia',
      url: 'https://www.aemet.es/es/eltiempo/prediccion/avisos',
    });
  });

  it('names the met office that issued a warning, not the aggregator', async () => {
    // MeteoAlarm's own terms: warnings from a single country must be credited
    // to that country's National Meteorological and Hydrological Service by
    // name, and only warnings spanning more than one are credited to EUMETNET.
    // One country's feed is asked at a time, so the office on the warnings
    // actually shown is the one owed the line — the aggregator keeps `name`,
    // and the credit a client is required to draw is `notice`.
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    });

    const meteoalarm = reading.attribution.find(
      (source) => source.name === 'MeteoAlarm',
    );
    expect(meteoalarm?.notice).toBe('AEMET. Agencia Estatal de Meteorologia');
    // And the delay wording travels with it, whether or not anything is in
    // force: it is the reason the alerts cache is five minutes wide.
    expect(meteoalarm?.disclaimer).toBe(METEOALARM_DELAY);
  });

  it('drops a warning that has already lapsed', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    });

    expect(reading.alerts?.map((alert) => alert.id)).not.toContain(
      'rain-lapsed',
    );
  });

  it('drops the warning an update replaces, keeping the update', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    });

    const ids = reading.alerts?.map((alert) => alert.id);
    expect(ids).not.toContain('snow-replaced');
    expect(ids).toContain('snow-update');
  });

  it('writes the warnings in English until a language is asked for', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    });

    expect(reading.alerts?.[0].event).toBe('Extreme rain warning');
  });

  it('writes them in the language asked for when the office publishes it', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      language: 'es',
      includeAlerts: true,
    });

    expect(reading.alerts?.[0].event).toBe('Aviso de lluvias de nivel rojo');
  });

  it('leaves the warnings out until they are asked for', async () => {
    const { service, calls } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
    });

    expect(reading.alerts).toBeUndefined();
    expect(calls.some((url) => url.includes('meteoalarm'))).toBe(false);
  });

  it('asks no feed for a country MeteoAlarm does not cover', async () => {
    const { service, calls } = build({
      ...routes,
      '/data/2.5/weather': current('Denver', 'US'),
    });

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 39.7,
      longitude: -105,
      includeAlerts: true,
    });

    expect(reading.alerts).toBeUndefined();
    expect(reading.attribution).toHaveLength(1);
    expect(calls.some((url) => url.includes('meteoalarm'))).toBe(false);
  });

  it('credits MeteoAlarm for saying nothing is in force', async () => {
    const { service } = build({
      ...routes,
      'feeds.meteoalarm.org': { warnings: [] },
    });

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    });

    expect(reading.alerts).toEqual([]);
    expect(reading.attribution).toContainEqual({
      name: 'MeteoAlarm',
      url: 'https://meteoalarm.org/',
      licence: 'https://meteoalarm.org/en/live/page/disclaimer',
      // No warning is on show, so there is no met office to name and the
      // aggregator's own credit stands. The disclaimer travels regardless:
      // "nothing is in force here" is a claim about live data too.
      notice: 'EUMETNET – MeteoAlarm',
      disclaimer: METEOALARM_DELAY,
      provides: ['alerts'],
    });
  });

  it('costs the warnings rather than the temperature when the feed is down', async () => {
    const { service } = build({
      ...routes,
      'feeds.meteoalarm.org': httpError(503),
    });

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    });

    expect(reading.current.temperature).toBe(24.3);
    expect(reading.alerts).toBeUndefined();
    expect(reading.attribution).toHaveLength(1);
  });

  it('serves a whole country one feed however many cells ask', async () => {
    const { service, calls } = build(routes);
    const question = { apiKey: 'key', includeAlerts: true };

    await service.getWeather({ ...question, latitude: 41.6, longitude: -0.9 });
    await service.getWeather({ ...question, latitude: 40.4, longitude: -3.7 });

    expect(calls.filter((url) => url.includes('meteoalarm'))).toHaveLength(1);
  });

  it('skips the forecast, and its call, when the caller turns it off', async () => {
    const { service, calls } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeForecast: false,
    });

    expect(reading.forecast).toEqual([]);
    expect(calls.some((url) => url.includes('/data/2.5/forecast'))).toBe(false);
    expect(reading.attribution[0].provides).toEqual(['weather', 'airQuality']);
  });

  it('collapses the range to the observation with no forecast to read it off', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeForecast: false,
    });

    expect(reading.current.high).toBe(24.3);
    expect(reading.current.low).toBe(24.3);
  });

  it('narrows the warnings to the regions the cell falls in', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    });

    expect(reading.alertScope).toBe('area');
    expect(reading.alerts?.map((alert) => alert.id)).not.toContain(
      'rain-coast',
    );
  });

  it('hands back the whole country when it cannot place the cell', async () => {
    const { service } = build({
      ...routes,
      '/data/2.5/weather': current('Reykjavik', 'IS'),
    });

    const reading = await service.getWeather({
      apiKey: 'key',
      // Off Iceland, so inside a country the atlas holds but outside every
      // region in it.
      latitude: 63.0,
      longitude: -24.0,
      includeAlerts: true,
    });

    expect(reading.alertScope).toBe('country');
    expect(reading.alerts?.map((alert) => alert.id)).toContain('rain-coast');
  });

  it('does not narrow when the atlas and the feed speak different codes', async () => {
    const nuts = {
      warnings: [
        {
          alert: {
            identifier: 'fr-wind',
            status: 'Actual',
            scope: 'Public',
            msgType: 'Alert',
            info: [
              {
                ...info('en-GB', 'Wind warning'),
                area: [
                  {
                    areaDesc: 'Landes',
                    geocode: [{ value: 'FR613', valueName: 'NUTS3' }],
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const { service } = build({
      ...routes,
      '/data/2.5/weather': current('Bordeaux', 'FR'),
      'feeds.meteoalarm.org': nuts,
    });

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 44.8,
      longitude: -0.6,
      includeAlerts: true,
    });

    expect(reading.alertScope).toBe('country');
    expect(reading.alerts?.map((alert) => alert.id)).toEqual(['fr-wind']);
  });

  it('keeps only the warnings at or above the safety band asked for', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
      safety: 'orange',
    });

    expect(reading.alerts?.map((alert) => alert.event)).toEqual([
      'Extreme rain warning',
      'Updated snow warning',
    ]);
  });

  it('takes the safety band by either of its two names', async () => {
    const { service } = build(routes);
    const question = {
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
    };

    const byColour = await service.getWeather({ ...question, safety: 'red' });
    const bySeverity = await service.getWeather({
      ...question,
      safety: 'Extreme',
    });

    expect(byColour.alerts?.map((alert) => alert.id)).toEqual(['rain-now']);
    expect(bySeverity.alerts?.map((alert) => alert.id)).toEqual(['rain-now']);
  });

  it('refuses a safety band it does not know rather than ignoring it', async () => {
    const { service } = build(routes);

    await expect(
      service.getWeather({
        apiKey: 'key',
        latitude: 41.6,
        longitude: -0.9,
        includeAlerts: true,
        safety: 'puce',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('filters by area name, ignoring case and accents', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      includeAlerts: true,
      area: 'RIBERA DEL EBRO',
    });

    expect(reading.alerts?.length).toBeGreaterThan(0);
    expect(
      reading.alerts?.every((alert) =>
        alert.areas.some((name) => name.includes('Ribera')),
      ),
    ).toBe(true);
  });

  it('filters by area given a region code instead of a name', async () => {
    const { service } = build({
      ...routes,
      '/data/2.5/weather': current('Reykjavik', 'IS'),
    });

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 63.0,
      longitude: -24.0,
      includeAlerts: true,
      area: 'ES191',
    });

    expect(reading.alerts?.map((alert) => alert.id)).toEqual(['rain-coast']);
  });

  it('costs the air quality field rather than the reading', async () => {
    const { service } = build({ ...routes, '/air_pollution': httpError(401) });

    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
    });

    expect(reading.current.temperature).toBe(24.3);
    expect(reading.current.airQuality).toBeUndefined();
    expect(reading.attribution[0].provides).toEqual(['weather', 'forecast']);
  });

  it("hands back the provider's refusal of the key as a 401", async () => {
    const { service } = build({
      ...routes,
      '/data/2.5/weather': httpError(401),
    });

    await expect(
      service.getWeather({ apiKey: 'wrong', latitude: 41.6, longitude: -0.9 }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("hands back the provider's rate limit as a 429", async () => {
    const { service } = build({
      ...routes,
      '/data/2.5/weather': httpError(429),
    });

    await expect(
      service.getWeather({ apiKey: 'key', latitude: 41.6, longitude: -0.9 }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('refuses a place the provider does not know', async () => {
    const { service } = build({ ...routes, '/geo/1.0/direct': [] });

    await expect(
      service.getWeather({ apiKey: 'key', location: 'Atlantis' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a request with no place in it', async () => {
    const { service } = build(routes);

    await expect(service.getWeather({ apiKey: 'key' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('refuses a request with no key of its own', async () => {
    const { service } = build(routes);

    await expect(
      service.getWeather({ latitude: 41.6, longitude: -0.9 }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('names the providers it does have when asked for one it has not', async () => {
    const { service } = build(routes);

    const failure: HttpException = await service
      .getWeather({
        apiKey: 'key',
        provider: 'accuweather',
        location: 'Madrid',
      })
      .catch((exception) => exception);

    expect(failure.getStatus()).toBe(400);
    expect(failure.message).toContain('openweather');
  });

  it('falls back to English rather than fragmenting the cache on a stray tag', async () => {
    const { service, calls } = build(routes);

    await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      language: 'not-a-language',
    });

    expect(asked(calls, '/data/2.5/weather')).toContain('lang=en');
  });

  it('passes a regional tag through in the spelling the provider uses', async () => {
    const { service, calls } = build(routes);

    await service.getWeather({
      apiKey: 'key',
      latitude: 41.6,
      longitude: -0.9,
      language: 'pt-BR',
    });

    expect(asked(calls, '/data/2.5/weather')).toContain('lang=pt_br');
  });
});

describe('listProviders', () => {
  it('lists what a caller can send in the provider header', () => {
    const { service } = build(routes);

    expect(service.listProviders()).toEqual([
      {
        id: 'openweather',
        name: 'OpenWeather',
        url: 'https://openweathermap.org/',
        apiKeyUrl: 'https://home.openweathermap.org/api_keys',
        geocoding: true,
        alerts: false,
        uv: false,
        airQuality: true,
        managed: false,
      },
      {
        id: 'apple',
        name: 'Apple Weather',
        url: 'https://developer.apple.com/weatherkit/',
        apiKeyUrl:
          'https://developer.apple.com/account/resources/authkeys/list',
        geocoding: false,
        alerts: true,
        uv: true,
        airQuality: false,
        // Nothing is configured under test, so nothing is held on anyone's
        // behalf and a caller still has to bring a token.
        managed: false,
      },
    ]);
  });
});

// WeatherKit answers in metric and only in metric, so every fixture below is
// in Apple's units — degrees Celsius, kilometres per hour, fractions rather
// than percentages — and the tests are about what comes out the other side.
const appleAlert = (
  id: string,
  description: string,
  severity: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  description,
  severity,
  urgency: 'Immediate',
  certainty: 'Observed',
  source: 'AEMET',
  areaId: 'ESZ001',
  areaName: 'Ribera del Ebro de Zaragoza',
  countryCode: 'ES',
  detailsUrl: `https://weatherkit.apple.com/alerts/${id}`,
  effectiveTime: iso(NOW - HOUR),
  eventEndTime: iso(NOW + HOUR),
  ...extra,
});

const appleBody = (extra: Record<string, unknown> = {}) => ({
  currentWeather: {
    metadata: {
      expireTime: iso(NOW + 15 * 60),
      attributionURL: APPLE_LEGAL,
    },
    asOf: iso(NOW),
    conditionCode: 'MostlyClear',
    daylight: true,
    cloudCover: 0.12,
    humidity: 0.41,
    pressure: 1014,
    temperature: 24.3,
    temperatureApparent: 23.8,
    uvIndex: 7,
    windDirection: 310,
    // 4.6 m/s, which is what the metric response should carry.
    windSpeed: 16.56,
  },
  forecastDaily: {
    days: [
      {
        forecastStart: iso(NOW - 6 * HOUR),
        forecastEnd: iso(NOW + 18 * HOUR),
        temperatureMax: 31.2,
        temperatureMin: 18.4,
        sunrise: iso(NOW - 6 * HOUR),
        sunset: iso(NOW + 7 * HOUR),
      },
    ],
  },
  forecastHourly: {
    hours: [
      {
        forecastStart: iso(NOW),
        temperature: 24.3,
        temperatureApparent: 23.8,
        conditionCode: 'MostlyClear',
        daylight: true,
        precipitationChance: 0.1,
        uvIndex: 7,
      },
      {
        forecastStart: iso(NOW + HOUR),
        temperature: 26,
        temperatureApparent: 25.4,
        conditionCode: 'Thunderstorms',
        daylight: true,
        precipitationChance: 0.6,
        uvIndex: 4,
      },
      {
        forecastStart: iso(NOW + 2 * HOUR),
        temperature: 21,
        temperatureApparent: 20.5,
        conditionCode: 'Cloudy',
        daylight: false,
        precipitationChance: 0.3,
        uvIndex: 1,
      },
    ],
  },
  ...extra,
});

/** The branding manifest, in the shape the public endpoint actually answers. */
const appleBranding = {
  'logoLight@1x': '/assets/branding/en/Apple_Weather_blk_en_1X.png',
  'logoLight@2x': '/assets/branding/en/Apple_Weather_blk_en_2X.png',
  'logoLight@3x': '/assets/branding/en/Apple_Weather_blk_en_3X.png',
  'logoDark@1x': '/assets/branding/en/Apple_Weather_wht_en_1X.png',
  'logoDark@2x': '/assets/branding/en/Apple_Weather_wht_en_2X.png',
  'logoDark@3x': '/assets/branding/en/Apple_Weather_wht_en_3X.png',
  'logoSquare@1x': '/assets/branding/square-mark.png',
  'logoSquare@2x': '/assets/branding/square-mark@2x.png',
  'logoSquare@3x': '/assets/branding/square-mark@3x.png',
  serviceName: 'Apple Weather',
};

const HOST = 'https://weatherkit.apple.com';

const logo = {
  light: {
    x1: `${HOST}/assets/branding/en/Apple_Weather_blk_en_1X.png`,
    x2: `${HOST}/assets/branding/en/Apple_Weather_blk_en_2X.png`,
    x3: `${HOST}/assets/branding/en/Apple_Weather_blk_en_3X.png`,
  },
  dark: {
    x1: `${HOST}/assets/branding/en/Apple_Weather_wht_en_1X.png`,
    x2: `${HOST}/assets/branding/en/Apple_Weather_wht_en_2X.png`,
    x3: `${HOST}/assets/branding/en/Apple_Weather_wht_en_3X.png`,
  },
  square: {
    x1: `${HOST}/assets/branding/square-mark.png`,
    x2: `${HOST}/assets/branding/square-mark@2x.png`,
    x3: `${HOST}/assets/branding/square-mark@3x.png`,
  },
};

const APPLE_LEGAL = 'https://weather-data.apple.com/legal-attribution.html';

/** Open-Meteo's keyless geocoder, which needs no key of any kind. */
const geocoded = {
  results: [
    {
      name: 'Zaragoza',
      latitude: 41.6488,
      longitude: -0.8891,
      country_code: 'ES',
    },
  ],
};

const appleRoutes = {
  ...routes,
  'geocoding-api.open-meteo.com': geocoded,
  'weatherkit.apple.com/attribution': appleBranding,
  'weatherkit.apple.com': appleBody(),
};

const appleWarnings = {
  ...routes,
  'weatherkit.apple.com/attribution': appleBranding,
  'weatherkit.apple.com': appleBody({
    weatherAlerts: {
      alerts: [
        appleAlert('wind-now', 'Wind Advisory', 'Minor'),
        appleAlert('rain-now', 'Flood Warning', 'Severe'),
        appleAlert('rain-lapsed', 'Flood Warning', 'Extreme', {
          eventEndTime: iso(NOW - HOUR),
        }),
      ],
    },
  }),
};

const ask = (extra: Record<string, unknown> = {}) => ({
  provider: 'apple',
  apiKey: 'signed.jwt.token',
  latitude: 41.6488,
  longitude: -0.8891,
  ...extra,
});

describe('apple weather', () => {
  it('sends the developer token as a bearer, never in the URL', async () => {
    const { service, calls, headers } = build(appleRoutes);

    await service.getWeather(ask());

    const url = asked(calls, 'weatherkit.apple.com') as string;
    expect(sentTo(calls, headers, 'weatherkit.apple.com')).toEqual({
      Authorization: 'Bearer signed.jwt.token',
    });
    expect(url).not.toContain('signed.jwt.token');
  });

  it('asks for every data set in one request, and names a time zone', async () => {
    const { service, calls } = build(appleRoutes);

    await service.getWeather(ask());

    const url = asked(calls, 'weatherkit.apple.com') as string;
    expect(url).toContain('/api/v1/weather/en/41.65/-0.89?');
    expect(url).toContain(
      'dataSets=currentWeather%2CforecastDaily%2CforecastHourly',
    );
    expect(url).toContain('timezone=Etc%2FGMT');
    // Nothing asked for warnings, so nothing asked for the data set that
    // carries them — the cached document cannot hold what was never fetched.
    expect(url).not.toContain('weatherAlerts');
  });

  it('estimates the time zone from the longitude', async () => {
    const { service, calls } = build(appleRoutes);

    const reading = await service.getWeather(
      ask({ latitude: 40.7128, longitude: -74.006 }),
    );

    expect(asked(calls, 'weatherkit.apple.com')).toContain(
      'timezone=Etc%2FGMT%2B5',
    );
    expect(reading.location.timezoneOffset).toBe(-5 * HOUR);
  });

  it('converts the metric document into the units asked for', async () => {
    const { service } = build(appleRoutes);

    const metric = await service.getWeather(ask());
    expect(metric.current.temperature).toBe(24.3);
    // Kilometres per hour on the wire, metres per second in the response.
    expect(metric.current.windSpeed).toBe(4.6);
    // Fractions on the wire, per cent in the response.
    expect(metric.current.humidity).toBe(41);
    expect(metric.current.cloudiness).toBe(12);
    expect(metric.current.pressure).toBe(1014);

    const imperial = await service.getWeather(ask({ units: 'imperial' }));
    expect(imperial.current.temperature).toBe(75.7);
    expect(imperial.current.windSpeed).toBe(10.29);

    const standard = await service.getWeather(ask({ units: 'standard' }));
    expect(standard.current.temperature).toBe(297.5);
  });

  it('serves all three unit systems from one upstream call', async () => {
    const { service, calls } = build(appleRoutes);

    await service.getWeather(ask());
    await service.getWeather(ask({ units: 'imperial' }));

    // The units are made here rather than asked for upstream, so they are not
    // part of the question and must not fragment the cache.
    expect(
      calls.filter((url) => url.includes('/api/v1/weather/')),
    ).toHaveLength(1);
  });

  it('names the condition, the icon and the id from Apple s one word', async () => {
    const { service } = build(appleRoutes);

    const reading = await service.getWeather(ask());

    expect(reading.current.description).toBe('mostly clear');
    expect(reading.current.icon).toBe('02d');
    expect(reading.current.condition).toBe(801);
    // Night on the third step, which is what decides the icon's suffix.
    expect(reading.forecast[2].icon).toBe('04n');
    expect(reading.forecast[1].condition).toBe(211);
  });

  it("takes the day's range from the daily forecast, not from the steps", async () => {
    const { service } = build(appleRoutes);

    const reading = await service.getWeather(ask({ includeForecast: false }));

    expect(reading.forecast).toEqual([]);
    // Unlike OpenWeather, turning the forecast off costs neither the range nor
    // the sun: Apple states both outright in the same document.
    expect(reading.current.high).toBe(31.2);
    expect(reading.current.low).toBe(18.4);
    expect(reading.current.sunrise).toBe(NOW - 6 * HOUR);
    expect(reading.current.sunset).toBe(NOW + 7 * HOUR);
  });

  it('answers the UV index without going to Open-Meteo', async () => {
    const { service, calls } = build(appleRoutes);

    const reading = await service.getWeather(ask({ includeUv: true }));

    expect(reading.current.uv).toBe(7);
    expect(reading.current.uvProtectionUntil).toBe(NOW + 2 * HOUR);
    // The UV endpoint specifically. Apple carries no pollutant, so the air
    // still comes from Open-Meteo's other one and the company is asked either
    // way — what this test is about is not asking it for the sun twice.
    expect(asked(calls, 'api.open-meteo.com/v1/forecast')).toBeUndefined();
    expect(reading.attribution).toEqual([
      {
        name: 'Apple Weather',
        url: 'https://developer.apple.com/weatherkit/',
        licence: APPLE_LEGAL,
        logo,
        provides: ['weather', 'forecast', 'uv'],
      },
    ]);
  });

  it('uses its own warnings and leaves MeteoAlarm out of it', async () => {
    const { service, calls } = build(appleWarnings);

    const reading = await service.getWeather(
      ask({ includeAlerts: true, country: 'es' }),
    );

    expect(asked(calls, 'feeds.meteoalarm.org')).toBeUndefined();
    expect(asked(calls, 'weatherkit.apple.com')).toContain('countryCode=ES');
    // Most severe first, and the one whose event has already ended is gone.
    expect(reading.alerts?.map((alert) => alert.id)).toEqual([
      'rain-now',
      'wind-now',
    ]);
    // Scoped to the coordinate by Apple itself, so no atlas lookup was needed
    // to earn the narrower scope.
    expect(reading.alertScope).toBe('area');
    expect(reading.alerts?.[0]).toMatchObject({
      event: 'Flood Warning',
      severity: 'Severe',
      sender: 'AEMET',
      areas: ['Ribera del Ebro de Zaragoza'],
      regions: [{ code: 'ESZ001', type: 'APPLE_AREA_ID' }],
      url: 'https://weatherkit.apple.com/alerts/rain-now',
    });
    // Apple has no colour band, so the warning ranks by its CAP severity.
    expect(reading.alerts?.[0].level).toBeUndefined();
    expect(reading.attribution).toEqual([
      {
        name: 'Apple Weather',
        url: 'https://developer.apple.com/weatherkit/',
        licence: APPLE_LEGAL,
        logo,
        provides: ['weather', 'forecast', 'alerts'],
      },
    ]);
  });

  it('applies the safety floor to Apple s warnings too', async () => {
    const { service } = build(appleWarnings);

    const reading = await service.getWeather(
      ask({ includeAlerts: true, country: 'ES', safety: 'orange' }),
    );

    expect(reading.alerts?.map((alert) => alert.id)).toEqual(['rain-now']);
  });

  it('serves every language from one document when no warnings are asked for', async () => {
    const { service, calls } = build(appleRoutes);

    await service.getWeather(ask());
    await service.getWeather(ask({ language: 'de' }));

    // Nothing in the document is localised without the warnings — the
    // conditions arrive as an English enum and are put into words here — so
    // the language must not fragment the cache.
    expect(
      calls.filter((url) => url.includes('/api/v1/weather/')),
    ).toHaveLength(1);
  });

  it('keeps the languages apart once the warnings are in the document', async () => {
    const { service, calls } = build(appleWarnings);

    await service.getWeather(ask({ includeAlerts: true, country: 'ES' }));
    await service.getWeather(
      ask({ includeAlerts: true, country: 'ES', language: 'de' }),
    );

    expect(
      calls.filter((url) => url.includes('/api/v1/weather/')),
    ).toHaveLength(2);
  });

  it('draws the mark and the legal link its terms require', async () => {
    const { service, calls } = build(appleRoutes);

    const reading = await service.getWeather(ask());
    const credit = reading.attribution[0];

    expect(asked(calls, '/attribution/')).toBe(
      'https://weatherkit.apple.com/attribution/en',
    );
    // The endpoint answers partial paths; a client should not have to know to
    // prefix them.
    expect(credit.logo).toEqual(logo);
    expect(credit.licence).toBe(APPLE_LEGAL);
  });

  it('still answers the weather when the branding manifest does not load', async () => {
    const { service } = build({
      ...appleRoutes,
      'weatherkit.apple.com/attribution': httpError(500),
    });

    const reading = await service.getWeather(ask());

    // A mark that will not load is a problem; losing the temperature over it
    // is a worse one, and the legal link still travels.
    expect(reading.current.temperature).toBe(24.3);
    expect(reading.attribution[0].logo).toBeUndefined();
    expect(reading.attribution[0].licence).toBe(APPLE_LEGAL);
  });

  it('signs for the caller when the deployment holds the key', async () => {
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const previous = { ...process.env };
    Object.assign(process.env, {
      WEATHERKIT_TEAM_ID: 'ABCDE12345',
      WEATHERKIT_SERVICE_ID: 'com.example.weather',
      WEATHERKIT_KEY_ID: 'FGHIJ67890',
      WEATHERKIT_PRIVATE_KEY: Buffer.from(
        privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      ).toString('base64'),
    });

    try {
      const { service, calls, headers } = build(appleRoutes, ['ours']);

      // No provider key at all: an app cannot carry a WeatherKit one, so a
      // configured deployment signs on its behalf — for a caller it knows.
      const reading = await service.getWeather({
        provider: 'apple',
        clientKey: 'ours',
        latitude: 41.6488,
        longitude: -0.8891,
      });

      expect(reading.current.temperature).toBe(24.3);
      expect(service.listProviders()).toContainEqual(
        expect.objectContaining({ id: 'apple', managed: true }),
      );

      const sent = sentTo(calls, headers, '/api/v1/weather/') as {
        Authorization: string;
      };
      expect(sent.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    } finally {
      process.env = previous;
    }
  });

  it('turns away a caller who would spend the quota without leave', async () => {
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const previous = { ...process.env };
    Object.assign(process.env, {
      WEATHERKIT_TEAM_ID: 'ABCDE12345',
      WEATHERKIT_SERVICE_ID: 'com.example.weather',
      WEATHERKIT_KEY_ID: 'FGHIJ67890',
      WEATHERKIT_PRIVATE_KEY: Buffer.from(
        privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      ).toString('base64'),
    });

    try {
      const { service, calls } = build(appleRoutes, ['ours']);
      const stranger = {
        provider: 'apple',
        latitude: 41.6488,
        longitude: -0.8891,
      };

      // Neither a key of their own nor one of ours.
      await expect(service.getWeather(stranger)).rejects.toThrow(
        'Send a client key it recognises',
      );
      await expect(
        service.getWeather({ ...stranger, clientKey: 'guessed' }),
      ).rejects.toThrow('Send a client key it recognises');

      // Refused before anything was spent, upstream or otherwise.
      expect(calls).toEqual([]);

      // A caller bringing their own token needs no leave from us: it is their
      // quota they are spending.
      const reading = await service.getWeather({
        ...stranger,
        apiKey: 'signed.jwt.token',
      });
      expect(reading.current.temperature).toBe(24.3);
    } finally {
      process.env = previous;
    }
  });

  it('prefers the token the caller sent over the one it holds', async () => {
    const { service, calls, headers } = build(appleRoutes);

    await service.getWeather(ask());

    // Nothing is configured here, but the rule is the same either way: a
    // caller's own token spends their quota rather than the deployment's.
    expect(sentTo(calls, headers, '/api/v1/weather/')).toEqual({
      Authorization: 'Bearer signed.jwt.token',
    });
  });

  it('names the wrong-header mistake instead of letting Apple 401 it', async () => {
    const { service, calls } = build(appleRoutes);

    // The client key and the WeatherKit token are both opaque strings in
    // adjacent headers. Sent in the wrong one, this used to reach Apple as a
    // bearer token and come back as "Apple Weather rejected the API key",
    // which points at the wrong thing entirely.
    await expect(
      service.getWeather(ask({ apiKey: 'utMSVo2wXx2rNqcylL0lKCSNWnRFieZ' })),
    ).rejects.toThrow('send it in X-Weather-Client-Key instead');

    // And not at the cost of an upstream call to find out.
    expect(asked(calls, '/api/v1/weather/')).toBeUndefined();
  });

  it('resolves a place name for a provider that cannot, and says who did', async () => {
    const { service, calls } = build(appleRoutes);

    const reading = await service.getWeather({
      provider: 'apple',
      apiKey: 'signed.jwt.token',
      location: 'Zaragoza',
    });

    // Apple answers the weather at a point and nothing else, so the name is
    // resolved elsewhere rather than the question being refused.
    expect(asked(calls, 'geocoding-api.open-meteo.com')).toContain(
      'name=Zaragoza',
    );
    expect(reading.location.name).toBe('Zaragoza');
    // Which also hands Apple the country its warnings are scoped by.
    expect(reading.location.country).toBe('ES');
    expect(asked(calls, '/api/v1/weather/')).toContain('/41.65/-0.89?');

    // Credited to whoever actually did it: Apple is not owed the geocoding.
    const apple = reading.attribution.find(
      (source) => source.name === 'Apple Weather',
    );
    expect(apple?.provides).not.toContain('geocoding');
    expect(reading.attribution).toContainEqual({
      name: 'Open-Meteo',
      url: 'https://open-meteo.com/',
      licence: 'https://creativecommons.org/licenses/by/4.0/',
      notice: 'Weather data by Open-Meteo.com',
      provides: ['geocoding'],
    });
  });

  it('still credits a provider for geocoding it did itself', async () => {
    const { service } = build(routes);

    const reading = await service.getWeather({
      apiKey: 'key',
      location: 'Madrid',
    });

    const openweather = reading.attribution.find(
      (source) => source.name === 'OpenWeather',
    );
    expect(openweather?.provides).toContain('geocoding');
    expect(
      reading.attribution.filter((source) => source.name === 'Open-Meteo'),
    ).toEqual([]);
  });

  it('refuses a country that is not a code', async () => {
    const { service } = build(appleRoutes);

    await expect(
      service.getWeather(ask({ includeAlerts: true, country: 'Spain' })),
    ).rejects.toThrow('Country must be an ISO alpha-2 code');
  });
});

describe('country', () => {
  it('unblocks the national warnings for a coordinate-only request', async () => {
    const { service, calls } = build(routes);

    // Without a country there is no feed to pick: a coordinate does not carry
    // one, and OpenWeather only names one once it has answered. Sending it
    // means the warnings go out alongside the reading rather than after it.
    const reading = await service.getWeather({
      apiKey: 'key',
      latitude: 41.6488,
      longitude: -0.8891,
      includeAlerts: true,
      country: 'es',
    });

    expect(asked(calls, 'feeds.meteoalarm.org')).toContain('feeds-spain');
    expect(reading.alerts?.length).toBeGreaterThan(0);
    // Not geocoded, so the caller's country decides which feed to ask and
    // nothing else: the place is still named by whoever answered the reading.
    expect(reading.location.name).toBe('Zaragoza');
  });
});
