/**
 * What the caller asks for. `location` and the coordinate pair are two ways of
 * saying the same thing — a name is geocoded by the provider and becomes the
 * other — and exactly one of them has to be there.
 */
export interface WeatherPayload {
  provider?: string;
  apiKey?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  language?: string;
  units?: WeatherUnits;
  includeUv?: boolean;
}

export type WeatherUnits = 'metric' | 'imperial' | 'standard';

/**
 * One source, and what this particular response owes it.
 *
 * `provides` lists only what actually landed in the payload: a build that asked
 * for the UV index and did not get it carries no Open-Meteo line, and a reading
 * whose provider refused the air quality endpoint does not claim it.
 */
export interface Attribution {
  name: string;
  url: string;
  provides: string[];
}

/** Where the reading is for, as the provider itself names it. */
export interface WeatherLocation {
  name: string;
  country: string;
  /** The coordinates actually asked about — rounded, so they name the cell. */
  latitude: number;
  longitude: number;
  /** Seconds the place is offset from UTC, for rendering its own clock. */
  timezoneOffset: number;
}

export interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  /** The day's range, taken from the forecast rather than the observation. */
  high: number;
  low: number;
  /** The provider's own words, in the requested language. */
  description: string;
  /** The provider's icon code — `01d`, `10n`. */
  icon: string;
  /**
   * The provider's condition id, which is finer than the icon code: every
   * atmospheric condition from mist to a tornado shares the code `50`.
   */
  condition: number;
  humidity: number;
  pressure: number;
  /** In the requested units: m/s for metric and standard, mph for imperial. */
  windSpeed: number;
  /** Degrees clockwise from north. */
  windDirection: number;
  cloudiness: number;
  sunrise: number;
  sunset: number;
  /** Unix seconds of the observation itself, not of the request. */
  observedAt: number;
  /** Air quality index, 1 (good) to 5 (very poor); absent if unanswered. */
  airQuality?: number;
  /** The UV index now; present only when the caller asked for it. */
  uv?: number;
  /**
   * Unix seconds at which the UV index drops back under the band where
   * protection is advised, and only there: below that band there is nothing to
   * be until.
   */
  uvProtectionUntil?: number;
}

/** One step of the short forecast, in whatever stride the provider answers. */
export interface ForecastStep {
  /** Unix seconds, so a step keeps its identity across a client's restart. */
  time: number;
  temperature: number;
  feelsLike: number;
  description: string;
  icon: string;
  condition: number;
  /** Chance of precipitation, 0 to 1. */
  precipitation: number;
}

export interface WeatherResponse {
  provider: string;
  units: WeatherUnits;
  location: WeatherLocation;
  current: CurrentWeather;
  forecast: ForecastStep[];
  attribution: Attribution[];
  /**
   * When the reading was taken, not when it was served. A cached answer keeps
   * the observation's own time, so a client running its own TTL over this
   * cannot stack its staleness on top of ours.
   */
  lastUpdated: string;
}

/** One entry of the provider catalogue, for callers picking one. */
export interface ProviderInfo {
  id: string;
  name: string;
  url: string;
  /** Where a caller goes to get a key of their own. */
  apiKeyUrl: string;
  /** Whether this provider can turn a place name into coordinates. */
  geocoding: boolean;
}
