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

  /**
   * The licence or legal page the source requires linked alongside the credit.
   * Apple's is the page WeatherKit itself names; OpenWeather's free tier is
   * CC BY-SA 4.0; Open-Meteo's is CC BY 4.0.
   * @example 'https://creativecommons.org/licenses/by-sa/4.0/'
   */
  licence?: string;

  /**
   * The mark the source requires shown, where it publishes one.
   *
   * Apple is why this exists: WeatherKit's terms ask for the Apple Weather
   * wordmark beside the data, not merely the words. A source that asks only
   * for a line of text has no `logo`, and a client draws `name` instead.
   */
  logo?: AttributionLogo;
}

/** One mark, in the three appearances a client may need to draw it in. */
export class AttributionLogo {
  /** For drawing on a light background. */
  light: AttributionImage;

  /** For drawing on a dark background. */
  dark: AttributionImage;

  /** The square mark, for where a wordmark will not fit. */
  square: AttributionImage;
}

/** One image at the three pixel densities its publisher ships it in. */
export class AttributionImage {
  /**
   * @1x
   * @example 'https://weatherkit.apple.com/assets/branding/en/Apple_Weather_blk_en_1X_090122.png'
   */
  x1: string;

  /** @2x */
  x2: string;

  /** @3x */
  x3: string;
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
   * European Air Quality Index, 1 (good) to 6 (extremely poor).
   *
   * The EEA's own scale and its own rule — the grade is the poorest of the five
   * pollutants, not their average. Computed from concentrations rather than
   * taken from whichever provider answered, so two providers cannot grade the
   * same air differently.
   *
   * Absent where nothing was measured. That is not a claim that the air is
   * clean, which is why it is left off rather than sent as a 1.
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

export class AlertRegion {
  /**
   * The region code, in whichever scheme published it.
   * @example 'ES191'
   */
  code: string;

  /**
   * The scheme the code is in. It travels with the code because codes collide
   * across schemes: four of France's `NUTS3` departments are spelled exactly
   * like `EMMA_ID` regions elsewhere.
   * @example 'EMMA_ID'
   */
  type: string;
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
   * The regions it is scoped by, each with the scheme its code is in —
   * `EMMA_ID` in most countries, `NUTS3` in France and Romania, `FIPS` in
   * Ireland, and Germany publishes its own `WARNCELLID` alongside `EMMA_ID`.
   */
  regions: AlertRegion[];

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
   * Narrowed to the regions the cell falls in where that is possible, and to
   * the country where it is not — see `alertScope`, and narrow further with
   * the `safety` and `area` query parameters.
   */
  alerts?: WeatherAlert[];

  /**
   * How `alerts` was narrowed, present whenever `alerts` is.
   *
   * `area` means the cell was placed in the region atlas and only the warnings
   * covering it came back. `country` means it could not be — a country that
   * scopes warnings by codes the atlas does not hold (France, Romania,
   * Ireland, Norway, Sweden), or a cell that landed off every region — and
   * everything the national feed carries came back instead. A short list means
   * two very different things under the two.
   * @example 'area'
   */
  alertScope?: 'area' | 'country';

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

  /**
   * Whether this provider issues its own warnings, rather than the response
   * borrowing them from MeteoAlarm. One that does covers more than Europe and
   * costs no extra call.
   * @example false
   */
  alerts: boolean;

  /**
   * Whether this provider carries the UV index itself, rather than the
   * response borrowing it from Open-Meteo.
   * @example false
   */
  uv: boolean;

  /**
   * Whether this deployment holds a credential for the provider, so a caller
   * may send no `X-Weather-Api-Key` at all. True only where a key cannot
   * reasonably be carried by the caller — Apple's is a token signed with a
   * developer key that must not ship inside an app.
   * @example false
   */
  managed: boolean;
}
