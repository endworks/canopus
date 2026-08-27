import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import {
  CurrentWeather,
  ForecastStep,
  ProviderInfo,
} from '../models/weather.interface';
import { FORECAST_STEPS, TTL } from '../utils';
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

/** One measurement of the air, of which only the index is worth passing on. */
type AirResponse = { list?: { main?: { aqi?: number } }[] };

type GeocodeResponse = {
  name?: string;
  country?: string;
  lat?: number;
  lon?: number;
}[];

@Injectable()
export class OpenWeatherProvider extends WeatherProvider {
  readonly info: ProviderInfo = {
    id: 'openweather',
    name: 'OpenWeather',
    url: 'https://openweathermap.org/',
    apiKeyUrl: 'https://home.openweathermap.org/api_keys',
    geocoding: true,
  };

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
    const { latitude, longitude, language, units, apiKey } = request;
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
      this.fetch<ForecastResponse>(
        `openweather/forecast/${cell}/${units}/${language}`,
        `${API_URL}/forecast`,
        apiKey,
        { ...params, cnt: String(FORECAST_STEPS) },
        TTL.forecast,
      ),
      // Swallowed rather than awaited with the rest: the air is one field, and
      // a key whose plan does not carry this endpoint should cost that field
      // rather than the temperature.
      this.fetch<AirResponse>(
        `openweather/air/${cell}`,
        `${API_URL}/air_pollution`,
        apiKey,
        { lat: params.lat, lon: params.lon },
        TTL.airQuality,
      ).catch(() => undefined),
    ]);

    const steps = this.steps(forecast);
    const airQuality = air?.list?.[0]?.main?.aqi;

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
      provides: ['weather', 'forecast', ...(airQuality ? ['airQuality'] : [])],
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
   * here.
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
