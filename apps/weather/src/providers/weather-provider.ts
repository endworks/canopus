import {
  CurrentWeather,
  ForecastStep,
  ProviderInfo,
  WeatherLocation,
  WeatherUnits,
} from '../models/weather.interface';

/** One question, already resolved to a cell and normalised. */
export interface WeatherRequest {
  apiKey: string;
  latitude: number;
  longitude: number;
  language: string;
  units: WeatherUnits;
  /** Whether the short forecast is worth the upstream call this time. */
  includeForecast: boolean;
}

/** A place a name resolved to, before it is rounded to a cell. */
export interface GeocodedPlace {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

/**
 * What a provider answers.
 *
 * `provides` is the credit half of the contract: it names the kinds of data
 * that actually came back, so a provider whose air quality endpoint is off the
 * caller's plan is not credited with air quality.
 */
export interface ProviderReading {
  location: WeatherLocation;
  current: CurrentWeather;
  forecast: ForecastStep[];
  provides: string[];
}

/**
 * A source of weather, of which there is currently one.
 *
 * Abstract rather than an interface so it can be a DI token: the module lists
 * the concrete classes and the registry keys them by `info.id`, which is what
 * the `X-Weather-Provider` header names. Adding a second provider is a class
 * and a line in that list.
 */
export abstract class WeatherProvider {
  abstract readonly info: ProviderInfo;

  /** A place name to coordinates, or nothing if the provider knows no such place. */
  abstract locate(
    query: string,
    apiKey: string,
    language: string,
  ): Promise<GeocodedPlace | undefined>;

  abstract read(request: WeatherRequest): Promise<ProviderReading>;
}
