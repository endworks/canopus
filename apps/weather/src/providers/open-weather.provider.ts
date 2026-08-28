import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import {
  AttributionLogo,
  CurrentWeather,
  DataKind,
  ForecastStep,
  ProviderInfo,
} from '../models/weather.interface';
import { FORECAST_STEPS, TTL } from '../utils';
import { europeanAqi } from './european-aqi';
import { upstreamGet } from './upstream';
import {
  GeocodedPlace,
  ProviderReading,
  WeatherProvider,
  WeatherRequest,
} from './weather-provider';

const API_URL = 'https://api.openweathermap.org/data/2.5';
const GEO_URL = 'https://api.openweathermap.org/geo/1.0';

type Condition = { id?: number; icon?: string; description?: string };

type CurrentResponse = {
  weather?: Condition[];
  main?: {
    temp?: number;
    feels_like?: number;
    humidity?: number;
    pressure?: number;
  };
  wind?: { speed?: number; deg?: number };
  clouds?: { all?: number };
  sys?: { sunrise?: number; sunset?: number; country?: string };
  dt?: number;
  timezone?: number;
  name?: string;
};

type ForecastResponse = {
  list?: {
    dt?: number;
    main?: { temp?: number; feels_like?: number };
    weather?: Condition[];
    pop?: number;
  }[];
};

/**
 * One measurement of the air.
 *
 * The concentrations, not the index beside them. OpenWeather answers an `aqi`
 * of its own — one to five, with five of the European index's six words — and
 * grading the same air on a different scale under the same names is the one
 * thing worse than not grading it. `components` is what every provider here can
 * be asked for, so it is what everything is graded from. See `european-aqi`.
 */
type AirResponse = {
  list?: {
    components?: {
      pm2_5?: number;
      pm10?: number;
      no2?: number;
      o3?: number;
      so2?: number;
    };
  }[];
};

type GeocodeResponse = {
  name?: string;
  country?: string;
  lat?: number;
  lon?: number;
}[];

/**
 * The mark OpenWeather requires shown, where this deployment serves it.
 *
 * Its licence makes attribution obligatory from the free plan up, in the
 * visible part of the application rather than on a legal page, and names the
 * logo as the form it takes — so unlike Open-Meteo's line of text there is
 * nothing to write, only a file to point at. The files are in the gateway,
 * which is the only process here that speaks HTTP.
 *
 * Undefined where `WEATHER_ASSETS_URL` is unset, which is the case worth
 * getting right: a deployment that has not been told its own public address
 * cannot build a URL that resolves, and a broken image is a worse credit than
 * none. It falls back to the name and the licence link, which is what it did
 * before the assets existed.
 *
 * `light` alone, and no `square`: OpenWeather publishes one master mark. Its
 * brand rules forbid recolouring it or moving its symbol, so the dark variant
 * and the square one are not ours to derive — see `AttributionLogo`.
 */
const logo = (env: NodeJS.ProcessEnv): AttributionLogo | undefined => {
  const base = env.WEATHER_ASSETS_URL?.trim().replace(/\/+$/, '');
  if (!base) return undefined;

  const file = (suffix = '') =>
    `${base}/openweather/openweather-logo${suffix}.png`;
  return { light: { x1: file(), x2: file('@2x'), x3: file('@3x') } };
};

@Injectable()
export class OpenWeatherProvider extends WeatherProvider {
  readonly info: ProviderInfo = {
    id: 'openweather',
    name: 'OpenWeather',
    url: 'https://openweathermap.org/',
    apiKeyUrl: 'https://home.openweathermap.org/api_keys',
    geocoding: true,
    // The free plan carries neither: the warnings come from MeteoAlarm and the
    // UV index from Open-Meteo, each credited separately in `attribution`.
    alerts: false,
    uv: false,
    // `/air_pollution` answers the five concentrations on the free plan.
    airQuality: true,
    // A key small enough to carry, and one the caller's own quota is spent
    // against, so it stays the caller's to send.
    managed: false,
  };

  /** Resolved once: the address a deployment serves from does not move. */
  private readonly logo = logo(process.env);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {
    super();
  }

  /**
   * A cached GET against OpenWeather.
   *
   * The key deliberately carries no trace of the API key: two callers standing
   * in the same cell are asking the same question, and the answer does not
   * depend on whose quota paid for it. `wrap` also coalesces concurrent misses,
   * so a burst on a cold cell costs one upstream call rather than one each.
   */
  private fetch<T>(
    key: string,
    path: string,
    apiKey: string,
    params: Record<string, string>,
    ttl: number,
  ): Promise<T> {
    const query = new URLSearchParams({ ...params, appid: apiKey });
    return this.cacheManager.wrap(
      key,
      () =>
        upstreamGet<T>(this.httpService, `${path}?${query}`, this.info.name),
      ttl,
    );
  }

  async locate(
    query: string,
    apiKey: string,
    language: string,
  ): Promise<GeocodedPlace | undefined> {
    const places = await this.fetch<GeocodeResponse>(
      `openweather/geocode/${language}/${query.trim().toLowerCase()}`,
      `${GEO_URL}/direct`,
      apiKey,
      { q: query, limit: '1' },
      TTL.geocode,
    );

    const place = places?.[0];
    if (
      !place ||
      typeof place.lat !== 'number' ||
      typeof place.lon !== 'number'
    )
      return undefined;

    return {
      name: place.name ?? query,
      country: place.country ?? '',
      latitude: place.lat,
      longitude: place.lon,
    };
  }

  async read(request: WeatherRequest): Promise<ProviderReading> {
    const {
      latitude,
      longitude,
      language,
      units,
      apiKey,
      includeForecast,
      includeAirQuality,
    } = request;
    const cell = `${latitude},${longitude}`;
    const params = {
      lat: String(latitude),
      lon: String(longitude),
      units,
      lang: language,
    };

    const [current, forecast, air] = await Promise.all([
      this.fetch<CurrentResponse>(
        `openweather/current/${cell}/${units}/${language}`,
        `${API_URL}/weather`,
        apiKey,
        params,
        TTL.current,
      ),
      // The day's high and low are read off these steps, so turning the
      // forecast off costs those too — see `current` below. Left to the caller
      // rather than fetched anyway and hidden: a client drawing only the
      // current conditions should not spend a call on a list it discards.
      includeForecast
        ? this.fetch<ForecastResponse>(
            `openweather/forecast/${cell}/${units}/${language}`,
            `${API_URL}/forecast`,
            apiKey,
            { ...params, cnt: String(FORECAST_STEPS) },
            TTL.forecast,
          )
        : undefined,
      // Swallowed rather than awaited with the rest: the air is one field, and
      // a key whose plan does not carry this endpoint should cost that field
      // rather than the temperature. Skipped outright where the caller does not
      // want it — this is a second call against their key for a field they have
      // said they will not draw.
      includeAirQuality
        ? this.fetch<AirResponse>(
            `openweather/air/${cell}`,
            `${API_URL}/air_pollution`,
            apiKey,
            { lat: params.lat, lon: params.lon },
            TTL.airQuality,
          ).catch(() => undefined)
        : undefined,
    ]);

    const steps = forecast ? this.steps(forecast) : [];
    const airQuality = europeanAqi(air?.list?.[0]?.components ?? {});

    return {
      location: {
        name: current.name ?? '',
        country: current.sys?.country ?? '',
        latitude,
        longitude,
        timezoneOffset: current.timezone ?? 0,
      },
      current: this.current(current, steps, airQuality),
      forecast: steps,
      // The free plan is CC BY-SA 4.0, which asks for the credit and the
      // licence link back — so the link travels rather than being folded into
      // the provider's home page. The mark travels with it where this
      // deployment serves one: the licence asks for both, not either.
      credit: {
        licence: 'https://creativecommons.org/licenses/by-sa/4.0/',
        ...(this.logo ? { logo: this.logo } : {}),
      },
      provides: [
        'weather',
        ...((includeForecast ? ['forecast'] : []) as DataKind[]),
        ...((airQuality ? ['airQuality'] : []) as DataKind[]),
      ],
    };
  }

  private steps(forecast: ForecastResponse): ForecastStep[] {
    return (forecast.list ?? [])
      .filter((step) => typeof step.dt === 'number')
      .map((step) => ({
        time: step.dt,
        temperature: step.main?.temp ?? 0,
        feelsLike: step.main?.feels_like ?? step.main?.temp ?? 0,
        description: step.weather?.[0]?.description ?? '',
        icon: step.weather?.[0]?.icon ?? '01d',
        condition: step.weather?.[0]?.id ?? 800,
        precipitation: step.pop ?? 0,
      }));
  }

  /**
   * The observation, with the day's range taken from the forecast.
   *
   * `main.temp_min` and `main.temp_max` on the current reading are the spread
   * across the reporting stations rather than today's high and low, which is a
   * different quantity that happens to have the same name. The forecast steps
   * are the same data a paid endpoint would answer with, and they are already
   * here — unless the caller turned them off, in which case the range collapses
   * to the observation rather than being invented from the wrong field.
   */
  private current(
    current: CurrentResponse,
    steps: ForecastStep[],
    airQuality?: number,
  ): CurrentWeather {
    const temperature = current.main?.temp ?? 0;
    const temperatures = steps.map((step) => step.temperature);

    return {
      temperature,
      feelsLike: current.main?.feels_like ?? temperature,
      high: temperatures.length
        ? Math.max(temperature, ...temperatures)
        : temperature,
      low: temperatures.length
        ? Math.min(temperature, ...temperatures)
        : temperature,
      description: current.weather?.[0]?.description ?? '',
      icon: current.weather?.[0]?.icon ?? '01d',
      condition: current.weather?.[0]?.id ?? 800,
      humidity: current.main?.humidity ?? 0,
      pressure: current.main?.pressure ?? 0,
      windSpeed: current.wind?.speed ?? 0,
      windDirection: current.wind?.deg ?? 0,
      cloudiness: current.clouds?.all ?? 0,
      sunrise: current.sys?.sunrise ?? 0,
      sunset: current.sys?.sunset ?? 0,
      observedAt: current.dt ?? Math.floor(Date.now() / 1000),
      // Left off rather than zeroed: nought is not a grade on this scale, and a
      // client draws the line only for a reading that has one.
      ...(airQuality ? { airQuality } : {}),
    };
  }
}
