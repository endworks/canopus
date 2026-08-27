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
  includeAlerts?: boolean;
  /** Least severity worth returning: a colour or a CAP severity. */
  safety?: string;
  /** Region name to keep, matched loosely against each warning's `areas`. */
  area?: string;
  /** Defaults to true: the forecast is what the day's high and low come from. */
  includeForecast?: boolean;
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
  /**
   * Warnings in force, most severe first — present only when the caller asked
   * for them and a feed answered.
   *
   * Scoped to the country, not to the cell. MeteoAlarm publishes one feed per
   * country and scopes each warning by a region code with no geometry attached
   * — and the codes are not even the same kind of code from one country to the
   * next — so narrowing to the cell would mean shipping a region atlas and
   * keeping it true. Every warning names its own `areas` instead, and a caller
   * who knows which region it stands in can say so better than a lookup table
   * would. An empty array is an answer: MeteoAlarm was asked and holds nothing.
   */
  alerts?: WeatherAlert[];
  /** How `alerts` was narrowed; present whenever `alerts` is. */
  alertScope?: AlertScope;
  attribution: Attribution[];
  /**
   * When the reading was taken, not when it was served. A cached answer keeps
   * the observation's own time, so a client running its own TTL over this
   * cannot stack its staleness on top of ours.
   */
  lastUpdated: string;
}

/** One region a warning is scoped by, in whichever scheme published it. */
export interface AlertRegion {
  code: string;
  /** `EMMA_ID`, `NUTS3`, `FIPS`, `WARNCELLID` — the scheme the code is in. */
  type: string;
}

/**
 * How the warnings were narrowed.
 *
 * `area` means the cell was placed in the atlas and only the warnings covering
 * it came back. `country` means it could not be — a country scoping its
 * warnings by codes the atlas does not hold, or a cell that landed off every
 * region — and everything the national feed carries came back instead. The
 * difference matters enough to say out loud: a short list means two very
 * different things under the two, and a caller told only the list would read
 * the wrong one as reassurance.
 */
export type AlertScope = 'area' | 'country';

/**
 * One warning in force over the place asked about.
 *
 * Straight out of CAP, with the two fields MeteoAlarm adds to it — the colour
 * band its maps are drawn in, and the phenomenon it files the warning under —
 * lifted out of the parameter list a client would otherwise have to parse.
 */
export interface WeatherAlert {
  /** The CAP identifier, stable across updates, so a client can dedupe. */
  id: string;
  /** The sender's name for the phenomenon, in the requested language. */
  event: string;
  headline: string;
  description: string;
  /** What the sender says to do about it; not every office writes one. */
  instruction?: string;
  /** CAP severity: `Minor`, `Moderate`, `Severe`, `Extreme`. */
  severity: string;
  /** MeteoAlarm's colour band: `green`, `yellow`, `orange`, `red`. */
  level?: string;
  /** What it is a warning of: `Wind`, `Rain`, `snow-ice`, `Thunderstorm`… */
  awareness?: string;
  /** CAP urgency: `Immediate`, `Expected`, `Future`, `Past`. */
  urgency: string;
  /** CAP certainty: `Observed`, `Likely`, `Possible`, `Unlikely`. */
  certainty: string;
  /** Unix seconds the warning starts. */
  onset: number;
  /** Unix seconds it lapses; absent where the sender set no end. */
  expires?: number;
  /**
   * The regions it covers, as the issuing office names them.
   *
   * The feed scopes a warning by region code alone and carries no geometry, so
   * this is what tells a caller whether a national warning is about their
   * valley. See `alerts` on the response.
   */
  areas: string[];
  /**
   * The regions it is scoped by, each with the scheme its code is in.
   *
   * The scheme has to travel with the code, because the codes collide across
   * schemes: four of France's `NUTS3` departments are spelled exactly like
   * `EMMA_ID` regions elsewhere in the atlas, and matching on the string alone
   * places a warning about the Gironde in the wrong country's map.
   */
  regions: AlertRegion[];
  /** The national met office that issued it. */
  sender: string;
  /** Where that office publishes its warnings. */
  url?: string;
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
