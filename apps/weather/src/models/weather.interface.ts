/**
 * What the caller asks for. `location` and the coordinate pair are two ways of
 * saying the same thing — a name is geocoded by the provider and becomes the
 * other — and exactly one of them has to be there.
 */
export interface WeatherPayload {
  provider?: string;
  apiKey?: string;
  /**
   * Proof the caller may spend this deployment's own credential.
   *
   * Only consulted when falling back to one — see `ProviderInfo.managed`. A
   * caller sending their own `apiKey` is spending their own quota and needs
   * none of this.
   */
  clientKey?: string;
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
  /**
   * ISO alpha-2 country the cell stands in, when the caller knows it.
   *
   * Warnings are scoped by country and the country is otherwise only known
   * once a place name has been geocoded — which a provider that does no
   * geocoding, such as Apple, never does. Sent by the caller it unblocks the
   * warnings for a coordinate-only request; absent, the reading is asked for
   * the country instead and a provider that does not name one simply has no
   * warnings to offer.
   */
  country?: string;
  /** Defaults to true: the forecast is what the day's high and low come from. */
  includeForecast?: boolean;
}

export type WeatherUnits = 'metric' | 'imperial' | 'standard';

/**
 * A kind of data a source can be owed credit for.
 *
 * One vocabulary rather than three: it is what `Attribution.provides` lists,
 * what `ProviderInfo.provides` declares a provider capable of, and what the
 * service asks a provider for. A new kind is a member here and nowhere else.
 */
export type DataKind =
  'weather' | 'forecast' | 'alerts' | 'uv' | 'airQuality' | 'geocoding';

/**
 * One source, and what this particular response owes it.
 *
 * `provides` lists only what actually landed in the payload: a build that asked
 * for the UV index and did not get it carries no Open-Meteo line, and a reading
 * whose provider refused the air quality endpoint does not claim it.
 */
export interface Attribution {
  name: string;
  /**
   * Where the credit points, which is also what any `notice` below must link
   * to: every source here requires the same address for both, and a client
   * that draws one link draws this one.
   */
  url: string;
  provides: DataKind[];
  /**
   * The words this source requires shown, verbatim, where it requires
   * particular ones.
   *
   * Absent is the common case and means the source asks only to be credited,
   * so a client draws `name`. Present, it is not a suggestion: Open-Meteo's
   * licence asks for "Weather data by Open-Meteo.com" beside the data,
   * Zaragoza's reuse terms ask for "Origen de los datos: Ayuntamiento de
   * Zaragoza", and MeteoAlarm's require the national met office that issued a
   * warning to be named rather than the aggregator that carried it. Rendering
   * `name` instead of these is a licence breach, not a style choice — which is
   * why they travel on the wire rather than living in whichever client
   * remembered to hard-code them.
   *
   * It is also not a translation target, which is the part that looks like a
   * bug and is not. A licence names a string, so the string is what satisfies
   * it: "Weather data by Open-Meteo.com" stays English in a Spanish client and
   * "Origen de los datos: Ayuntamiento de Zaragoza" stays Spanish in an
   * English one, because a translated credit names an entity the terms have
   * never heard of. The three sources that do vary by language vary on their
   * own, without this field being asked to: MeteoAlarm's is the met office's
   * name read out of whichever CAP block matched the language, so it arrives
   * already in it; Apple's is artwork rather than words and is fetched per
   * language into `logo`; and OpenWeather's is a mark that carries no words to
   * translate. A `notice` a client feels the urge to translate is one it has
   * misread as UI copy.
   */
  notice?: string;
  /**
   * A statement the source requires published alongside its data.
   *
   * Separate from `notice` because it is a separate obligation and a client
   * places it differently: the notice belongs beside the reading, and this
   * belongs wherever the caveats go. MeteoAlarm is the reason it exists — every
   * redistributor must carry its wording about the delay between their copy and
   * the live site, because a stale severe-weather warning is the one thing on
   * this endpoint that could get somebody hurt.
   */
  disclaimer?: string;
  /**
   * The licence or legal page the source requires linked, where it requires
   * one. Apple's is the attribution page named by the reading itself;
   * OpenWeather's free tier is CC BY-SA 4.0; Open-Meteo's is CC BY 4.0. A
   * client that draws the credit at all should draw this link with it.
   */
  licence?: string;
  /**
   * The mark the source requires shown, where it publishes one.
   *
   * Apple is the reason this exists: WeatherKit's terms ask for the Apple
   * Weather wordmark beside the data, not merely the words, and the artwork is
   * served per language. OpenWeather asks for a mark too — its licence makes
   * attribution obligatory from the free plan up, in the visible part of the
   * application rather than on a legal page, and names its logo as the form it
   * takes — so this is where that belongs when the assets are wired, not
   * `notice`: there is no sentence it asks for.
   *
   * A source that asks only for a line of text has no `logo`, and one that
   * asks only to be credited has neither, so a client draws its `name`.
   */
  logo?: AttributionLogo;
}

/**
 * One mark, in whichever appearances its publisher ships it in.
 *
 * Only `light` is promised, because only Apple ships the full set. Its
 * attribution endpoint serves a wordmark for light and for dark backgrounds
 * and a square mark besides, which is where this shape came from; OpenWeather
 * publishes a single master logo and nothing else.
 *
 * A missing `dark` is the one absence that matters, and it is not an
 * invitation to improvise: brand rules forbid recolouring a mark, so a client
 * that has only a dark-on-transparent wordmark and a dark surface must give it
 * a light surface of its own — a chip, a plate, a footer — rather than tint it
 * or drop the credit. Missing `square` simply means the wordmark is the only
 * form there is, so a layout too narrow for it needs to find the room.
 */
export interface AttributionLogo {
  /** For drawing on a light background. The one every publisher ships. */
  light: AttributionImage;
  /** For drawing on a dark background, where the publisher draws one. */
  dark?: AttributionImage;
  /** The square mark, for where a wordmark will not fit, where there is one. */
  square?: AttributionImage;
}

/**
 * One image, at whichever pixel densities its publisher ships it in.
 *
 * `x1` is the base asset and the only one promised: Apple serves all three,
 * and a publisher that ships a single high-resolution file has it here for a
 * client to scale. Read as "the largest of these that exists", not as "the one
 * matching this screen" — a wordmark drawn a hundred points wide is legible
 * downscaled from any of them and blurry upscaled from none.
 */
export interface AttributionImage {
  /** @1x, or the single asset where that is all there is. */
  x1: string;
  /** @2x */
  x2?: string;
  /** @3x */
  x3?: string;
}

/** Where the reading is for, as the provider itself names it. */
export interface WeatherLocation {
  name: string;
  country: string;
  /** The coordinates actually asked about — rounded, so they name the cell. */
  latitude: number;
  longitude: number;
  /**
   * Seconds the place is offset from UTC, for rendering its own clock.
   *
   * Exact where the provider states it. Where it does not — WeatherKit answers
   * no time zone at all — this is the solar offset of the cell's longitude,
   * which is right to the hour across most of the world and can be two out
   * where a country keeps a clock its longitude does not justify, or is on
   * summer time.
   */
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
   * The condition id, which is finer than the icon code: every atmospheric
   * condition from mist to a tornado shares the icon `50`.
   *
   * Always on OpenWeather's scale, whichever provider answered. A provider
   * whose own vocabulary is different — Apple names conditions in words — is
   * mapped onto it, so that a client switches on one set of ids rather than
   * learning a second when it changes provider.
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
  /**
   * European Air Quality Index, 1 (good) to 6 (extremely poor).
   *
   * Computed here from concentrations rather than taken from a provider, so
   * every provider grades the same air the same way — see `european-aqi`.
   * Absent where nothing was measured, which is not the same as clean air.
   */
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
   * From the weather provider itself where it issues warnings — Apple does,
   * for the coordinate asked about and for most of the world — and from
   * MeteoAlarm otherwise, which covers Europe and scopes by country. How wide
   * the net was is in `alertScope` rather than left to be inferred.
   *
   * MeteoAlarm publishes one feed per country and scopes each warning by a
   * region code with no geometry attached — and the codes are not even the same
   * kind of code from one country to the next — so narrowing to the cell means
   * placing it in the region atlas, which only works where the atlas speaks the
   * same scheme the feed does. Every warning names its own `areas` too, and a
   * caller who knows which region it stands in can say so better than a lookup
   * table would. An empty array is an answer: a feed was asked and holds
   * nothing.
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
 * `area` means the warnings came back narrowed to the place — either because
 * the cell was placed in the region atlas, or because the provider scopes its
 * own warnings to the coordinate it was asked about, as Apple does. `country`
 * means neither: a country scoping its warnings by codes the atlas does not
 * hold, or a cell that landed off every region, and everything the national
 * feed carries came back instead. The difference matters enough to say out
 * loud: a short list means two very different things under the two, and a
 * caller told only the list would read the wrong one as reassurance.
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
  /**
   * Whether this provider issues its own warnings.
   *
   * True means the warnings come back inside the reading and MeteoAlarm is not
   * asked at all — the provider is nearer the source, covers more of the world
   * than Europe, and costs no extra call. It also means the provider is the one
   * credited for them in `attribution`.
   */
  alerts: boolean;
  /**
   * Whether this provider carries the UV index itself.
   *
   * True means Open-Meteo is not asked: the index is already in the document
   * the reading came from, so a caller who wants it adds neither a third party
   * to their request nor a call to anyone's quota.
   */
  uv: boolean;
  /**
   * Whether this provider answers pollutant concentrations of its own.
   *
   * The index is never the provider's — it is computed here, from whatever
   * concentrations came back, so that two providers cannot grade the same air
   * differently. See `european-aqi`. This only says whether the concentrations
   * arrive with the reading or have to be asked of Open-Meteo, which answers
   * them without a key.
   */
  airQuality: boolean;
  /**
   * Whether this deployment holds a credential for the provider itself.
   *
   * True means a caller may send no key at all, because one cannot reasonably
   * be carried: Apple's is a token signed with a developer key, and an app
   * that shipped that key would be handing it to anyone who unzipped the
   * bundle. False is the usual case and means the key is the caller's to send.
   */
  managed: boolean;
}
