export type WeatherUnits = 'metric' | 'imperial' | 'standard';

export class Attribution {
  /**
   * The source's own name, as it asks to be credited.
   * @example 'OpenWeather'
   */
  name: string;

  /**
   * Where to link that credit.
   * @example 'https://openweathermap.org/'
   */
  url: string;

  /**
   * What this response owes the source. Only what actually came back: a key
   * whose plan carries no air quality produces no `airQuality` entry.
   * @example ['weather', 'forecast', 'airQuality', 'geocoding']
   */
  provides: string[];
}

export class WeatherLocation {
  /**
   * The place, as the provider names it.
   * @example 'Zaragoza'
   */
  name: string;

  /**
   * ISO 3166 country code.
   * @example 'ES'
   */
  country: string;

  /**
   * Latitude actually asked about, rounded to a ~11 km cell.
   * @example 41.6
   */
  latitude: number;

  /**
   * Longitude actually asked about, rounded to a ~11 km cell.
   * @example -0.9
   */
  longitude: number;

  /**
   * Seconds the place is offset from UTC.
   * @example 7200
   */
  timezoneOffset: number;
}

export class CurrentWeather {
  /**
   * Temperature, in the requested units.
   * @example 24.3
   */
  temperature: number;

  /**
   * Apparent temperature, in the requested units.
   * @example 23.8
   */
  feelsLike: number;

  /**
   * Highest temperature across the returned forecast window.
   * @example 31.2
   */
  high: number;

  /**
   * Lowest temperature across the returned forecast window.
   * @example 18.4
   */
  low: number;

  /**
   * The provider's own words, in the requested language.
   * @example 'cielo claro'
   */
  description: string;

  /**
   * The provider's icon code.
   * @example '01d'
   */
  icon: string;

  /**
   * The provider's condition id, finer than the icon code.
   * @example 800
   */
  condition: number;

  /**
   * Relative humidity, as a percentage.
   * @example 41
   */
  humidity: number;

  /**
   * Atmospheric pressure, in hPa.
   * @example 1014
   */
  pressure: number;

  /**
   * Wind speed: m/s for metric and standard units, mph for imperial.
   * @example 4.6
   */
  windSpeed: number;

  /**
   * Wind direction, in degrees clockwise from north.
   * @example 310
   */
  windDirection: number;

  /**
   * Cloud cover, as a percentage.
   * @example 0
   */
  cloudiness: number;

  /**
   * Sunrise, in unix seconds.
   * @example 1756270800
   */
  sunrise: number;

  /**
   * Sunset, in unix seconds.
   * @example 1756319400
   */
  sunset: number;

  /**
   * When the reading was taken, in unix seconds — not when it was served.
   * @example 1756296000
   */
  observedAt: number;

  /**
   * Air quality index, 1 (good) to 5 (very poor). Absent when the provider
   * did not answer it.
   * @example 2
   */
  airQuality?: number;

  /**
   * UV index now. Present only when `X-Weather-Uv` asked for it and the
   * second provider answered.
   * @example 7.2
   */
  uv?: number;

  /**
   * Unix seconds at which the UV index drops back under 3, the reading at
   * which protection stops being advised. Absent below that band, where there
   * is nothing to be until.
   * @example 1756310400
   */
  uvProtectionUntil?: number;
}

export class ForecastStep {
  /**
   * Unix seconds this step is for.
   * @example 1756306800
   */
  time: number;

  /**
   * Temperature, in the requested units.
   * @example 28.1
   */
  temperature: number;

  /**
   * Apparent temperature, in the requested units.
   * @example 27.4
   */
  feelsLike: number;

  /**
   * The provider's own words, in the requested language.
   * @example 'nubes dispersas'
   */
  description: string;

  /**
   * The provider's icon code.
   * @example '03d'
   */
  icon: string;

  /**
   * The provider's condition id.
   * @example 802
   */
  condition: number;

  /**
   * Chance of precipitation, 0 to 1.
   * @example 0.2
   */
  precipitation: number;
}

export class WeatherAlert {
  /**
   * The CAP identifier, stable across updates so a client can dedupe.
   * @example '2.49.0.0.724.0.ES.260822032408.694303PRP2220569048'
   */
  id: string;

  /**
   * The sender's name for the phenomenon, in the requested language.
   * @example 'Extreme rain warning'
   */
  event: string;

  /**
   * One line naming the warning and the region.
   * @example 'Extreme rain warning. Litoral norte de Tarragona'
   */
  headline: string;

  /**
   * What the office says is coming.
   * @example 'Twelve-hours accumulated precipitation: 180 mm.'
   */
  description: string;

  /**
   * What to do about it. Absent where the office writes no advice.
   * @example 'Take precautionary action and remain vigilant.'
   */
  instruction?: string;

  /**
   * CAP severity.
   * @example 'Extreme'
   */
  severity: string;

  /**
   * MeteoAlarm's colour band, which is what its maps are drawn in.
   * @example 'red'
   */
  level?: string;

  /**
   * What it is a warning of.
   * @example 'Rain'
   */
  awareness?: string;

  /**
   * CAP urgency.
   * @example 'Immediate'
   */
  urgency: string;

  /**
   * CAP certainty.
   * @example 'Observed'
   */
  certainty: string;

  /**
   * When the warning starts, in unix seconds.
   * @example 1756263600
   */
  onset: number;

  /**
   * When it lapses, in unix seconds. Absent where the office set no end.
   * @example 1756270799
   */
  expires?: number;

  /**
   * The regions it covers, as the issuing office names them — the only thing
   * that says whether a national warning is about the caller's own valley.
   * @example ['Litoral norte de Tarragona']
   */
  areas: string[];

  /**
   * The national met office that issued it.
   * @example 'AEMET. Agencia Estatal de Meteorología'
   */
  sender: string;

  /**
   * Where that office publishes its warnings.
   * @example 'https://www.aemet.es/es/eltiempo/prediccion/avisos'
   */
  url?: string;
}

export class WeatherReading {
  /**
   * The provider that answered.
   * @example 'openweather'
   */
  provider: string;

  /**
   * The units the numbers are in.
   * @example 'metric'
   */
  units: WeatherUnits;

  /** Where the reading is for. */
  location: WeatherLocation;

  /** Conditions now. */
  current: CurrentWeather;

  /**
   * The next steps of the short forecast, three hours apart. Empty when
   * `X-Weather-Forecast` turned it off.
   */
  forecast: ForecastStep[];

  /**
   * Warnings in force, most severe first. Present only when
   * `X-Weather-Alerts` asked for them and a feed answered — an empty array
   * means MeteoAlarm was asked and holds nothing for the country.
   *
   * Scoped to the country rather than to the cell: MeteoAlarm publishes one
   * feed per country and scopes each warning by a region code carrying no
   * geometry, so each warning names its own `areas` instead.
   */
  alerts?: WeatherAlert[];

  /** Every source this response owes a credit, and what for. */
  attribution: Attribution[];

  /**
   * When the reading was taken, not when it was served — so a client running
   * its own TTL over this cannot stack its staleness on top of the cache's.
   * @example '2026-08-27T10:00:00.000Z'
   */
  lastUpdated: string;
}

export class WeatherProviderInfo {
  /**
   * The id the `X-Weather-Provider` header names.
   * @example 'openweather'
   */
  id: string;

  /**
   * The provider's own name.
   * @example 'OpenWeather'
   */
  name: string;

  /**
   * The provider's home page.
   * @example 'https://openweathermap.org/'
   */
  url: string;

  /**
   * Where a caller goes to get a key of their own.
   * @example 'https://home.openweathermap.org/api_keys'
   */
  apiKeyUrl: string;

  /**
   * Whether this provider can turn a place name into coordinates.
   * @example true
   */
  geocoding: boolean;
}
