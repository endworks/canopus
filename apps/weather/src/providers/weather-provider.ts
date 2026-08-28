import {
  AlertScope,
  Attribution,
  CurrentWeather,
  DataKind,
  ForecastStep,
  ProviderInfo,
  WeatherAlert,
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
  /**
   * Whether to ask for warnings, and only meaningful to a provider that issues
   * them — see `ProviderInfo.alerts`. A provider that does not simply ignores
   * it and the service asks MeteoAlarm instead.
   */
  includeAlerts: boolean;
  /**
   * Whether to include the UV index, and only meaningful to a provider that
   * carries one — see `ProviderInfo.uv`. Open-Meteo answers for the rest.
   */
  includeUv: boolean;
  /**
   * Whether the air is worth a call, and only meaningful to a provider that
   * carries concentrations — see `ProviderInfo.airQuality`.
   *
   * On unless the caller said otherwise, because it always has been. Off, the
   * provider skips its own endpoint for it: OpenWeather's `/air_pollution` is
   * a second request against the caller's key, and paying for a field nobody
   * draws is the whole thing this turns off.
   */
  includeAirQuality: boolean;
  /**
   * ISO alpha-2 country of the cell, where it is known.
   *
   * WeatherKit wants it to scope its warnings, and it is not knowable from a
   * coordinate alone — so it arrives from the caller, or from a place name
   * having been geocoded, or not at all.
   */
  country?: string;
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
  /**
   * The warnings the provider itself issues, unfiltered and most severe first.
   *
   * Present only from a provider whose `info.alerts` is true and only when the
   * caller asked. The distinction the response cares about survives here: an
   * empty array means the provider was asked and holds none, and `undefined`
   * means it was never in a position to answer.
   */
  alerts?: WeatherAlert[];
  /**
   * How wide those warnings were cast, which only the provider knows.
   *
   * WeatherKit scopes them to the coordinate it was asked about, so `area`.
   * A provider that issued a whole country's worth would say `country`, and
   * the service must not assume either on its behalf — telling a caller their
   * list is narrowed when it is national is the one thing `AlertScope` exists
   * to prevent.
   */
  alertScope?: AlertScope;
  /**
   * What this source requires shown beyond its name and a link.
   *
   * Fetched by the provider because only it knows what its terms ask for and
   * where the artwork lives; merged by the service into the source's line in
   * `attribution`.
   */
  credit?: Pick<Attribution, 'licence' | 'logo' | 'notice' | 'disclaimer'>;
  provides: DataKind[];
}

/**
 * A source of weather.
 *
 * Abstract rather than an interface so it can be a DI token: the module lists
 * the concrete classes and the registry keys them by `info.id`, which is what
 * the `X-Weather-Provider` header names. Adding a second provider is a class
 * and a line in that list.
 */
export abstract class WeatherProvider {
  abstract readonly info: ProviderInfo;

  /**
   * A credential this deployment holds on the caller's behalf.
   *
   * Normally nothing: the caller brings their own key and this service holds
   * none. A provider whose credential a client cannot physically carry — Apple
   * wants a token signed with a key that must not ship in an app bundle —
   * offers one here when the deployment has been configured with it, and
   * `info.managed` says so out loud. A key the caller does send still wins.
   */
  credential?(): string | undefined;

  /** A place name to coordinates, or nothing if the provider knows no such place. */
  abstract locate(
    query: string,
    apiKey: string,
    language: string,
  ): Promise<GeocodedPlace | undefined>;

  abstract read(request: WeatherRequest): Promise<ProviderReading>;
}
