import { HttpService } from '@nestjs/axios';
import { HttpException } from '@nestjs/common';
import { createCache } from 'cache-manager';
import { of, throwError } from 'rxjs';
import { MeteoAlarmProvider } from '../providers/meteoalarm.provider';
import { OpenMeteoUvProvider } from '../providers/open-meteo-uv.provider';
import { OpenWeatherProvider } from '../providers/open-weather.provider';
import { WeatherService } from './weather.service';

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

const air = { list: [{ main: { aqi: 2 } }] };

const uvBody = {
  current: { uv_index: 7.2 },
  hourly: {
    time: [NOW, NOW + HOUR, NOW + 2 * HOUR],
    uv_index: [7.2, 4.1, 1.2],
  },
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** One CAP info block, in the shape MeteoAlarm actually publishes. */
const info = (
  language: string,
  event: string,
  extra: Record<string, unknown> = {},
) => ({
  language,
  event,
  headline: `${event}. Litoral norte de Tarragona`,
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
      areaDesc: 'Litoral norte de Tarragona',
      geocode: [{ value: 'ES191', valueName: 'EMMA_ID' }],
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
    warning(
      'snow-update',
      [info('en-GB', 'Updated snow warning', { severity: 'Severe' })],
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

/** The URL a given upstream was asked with, whatever order it went out in. */
const asked = (calls: string[], fragment: string) =>
  calls.find((url) => url.includes(fragment));

const build = (routes: Record<string, unknown>) => {
  const { http, calls } = fakeHttp(routes);
  const cache = createCache();
  const provider = new OpenWeatherProvider(cache, http);
  const uv = new OpenMeteoUvProvider(cache, http);
  const meteoalarm = new MeteoAlarmProvider(cache, http);
  const service = new WeatherService(
    new Map([[provider.info.id, provider]]),
    uv,
    meteoalarm,
  );
  return { service, calls };
};

const routes = {
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

    expect(reading.location.latitude).toBe(41.6);
    expect(reading.location.longitude).toBe(-0.9);
    expect(asked(calls, '/data/2.5/weather')).toContain('lat=41.6&lon=-0.9');
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

    expect(calls).toHaveLength(3);
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
      latitude: 40.4,
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
        provides: ['weather', 'forecast', 'airQuality', 'geocoding'],
      },
      {
        name: 'Open-Meteo',
        url: 'https://open-meteo.com/',
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
      areas: ['Litoral norte de Tarragona'],
      sender: 'AEMET. Agencia Estatal de Meteorologia',
      url: 'https://www.aemet.es/es/eltiempo/prediccion/avisos',
    });
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
      },
    ]);
  });
});
