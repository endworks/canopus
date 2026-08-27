import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import {
  Attribution,
  AttributionImage,
  CurrentWeather,
  DataKind,
  ForecastStep,
  ProviderInfo,
  WeatherAlert,
  WeatherUnits,
} from '../models/weather.interface';
import {
  FORECAST_STEPS,
  seconds,
  TTL,
  UV_PROTECTION,
  uvReading,
} from '../utils';
import { inForce } from './alert-filter';
import { describe } from './apple-conditions';
import { upstreamGet } from './upstream';
import {
  GeocodedPlace,
  ProviderReading,
  WeatherProvider,
  WeatherRequest,
} from './weather-provider';
import {
  WeatherKitCredential,
  weatherKitCredential,
} from './weatherkit-credential';

const HOST = 'https://weatherkit.apple.com';
const API_URL = `${HOST}/api/v1/weather`;
const ATTRIBUTION_URL = `${HOST}/attribution`;

/**
 * The scheme Apple's `areaId` is in, for the region a warning is scoped by.
 *
 * Not one of the European schemes the atlas holds — in the United States it is
 * an NWS zone — so it is named for what it is rather than borrowed. Nothing
 * narrows by it; it travels so a client that knows the scheme can.
 */
const AREA_ID = 'APPLE_AREA_ID';

/** How long a document may be held, whatever `expireTime` claims. */
const TTL_FLOOR = 1000 * 60;

type AppleAlert = {
  id?: string;
  description?: string;
  detailsUrl?: string;
  areaId?: string;
  areaName?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  source?: string;
  effectiveTime?: string;
  eventOnsetTime?: string;
  eventEndTime?: string;
  expireTime?: string;
  issuedTime?: string;
};

type AppleDay = {
  forecastStart?: string;
  forecastEnd?: string;
  temperatureMax?: number;
  temperatureMin?: number;
  sunrise?: string;
  sunset?: string;
};

type AppleHour = {
  forecastStart?: string;
  temperature?: number;
  temperatureApparent?: number;
  conditionCode?: string;
  daylight?: boolean;
  precipitationChance?: number;
  uvIndex?: number;
};

/**
 * The branding endpoint's answer: partial paths, and the service's own name.
 *
 * Keyed `logoLight@2x` and so on, which is not an identifier, so the keys are
 * read by string rather than destructured.
 */
type AttributionResponse = Record<string, string | undefined>;

type WeatherKitResponse = {
  currentWeather?: {
    metadata?: { expireTime?: string; attributionURL?: string };
    asOf?: string;
    conditionCode?: string;
    daylight?: boolean;
    cloudCover?: number;
    humidity?: number;
    pressure?: number;
    temperature?: number;
    temperatureApparent?: number;
    uvIndex?: number;
    windDirection?: number;
    windSpeed?: number;
  };
  forecastDaily?: { days?: AppleDay[] };
  forecastHourly?: { hours?: AppleHour[] };
  weatherAlerts?: { alerts?: AppleAlert[] };
};

/**
 * Apple Weather, by way of WeatherKit's REST API.
 *
 * Three things about it are unlike the other provider here, and each one shows
 * up in this file.
 *
 * The credential is not an API key. WeatherKit takes an ES256 developer token
 * in `Authorization`, signed with a key from the Apple Developer Program, and
 * the caller sends that token where the other provider takes a key — the same
 * `X-Weather-Api-Key` header, carrying a JWT. Signing it here would mean this
 * service holding a private key that signs for the caller's whole team, which
 * is a much larger thing to be trusted with than one provider's key, and the
 * point of this endpoint is that it holds neither.
 *
 * One request answers everything. Current conditions, both forecasts and the
 * warnings arrive in a single document, so `includeForecast` shapes the payload
 * here rather than saving an upstream call, and the warnings cost nothing over
 * asking for the temperature alone.
 *
 * It knows the weather and nothing else. No geocoding forward or back, so a
 * place name cannot be resolved and the reading names no town and no country.
 * The service says so plainly rather than inventing one.
 */
@Injectable()
export class AppleWeatherProvider extends WeatherProvider {
  readonly info: ProviderInfo;

  /**
   * The key this deployment was configured with, if it was. Read once at boot
   * rather than per request, so a deployment that is misconfigured says so
   * while someone is still watching the logs.
   */
  private readonly signer?: WeatherKitCredential;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {
    super();
    this.signer = weatherKitCredential();
    this.info = {
      id: 'apple',
      name: 'Apple Weather',
      url: 'https://developer.apple.com/weatherkit/',
      apiKeyUrl: 'https://developer.apple.com/account/resources/authkeys/list',
      geocoding: false,
      alerts: true,
      uv: true,
      // WeatherKit carries no pollutant of any kind, so Open-Meteo is asked.
      airQuality: false,
      managed: this.signer !== undefined,
    };
  }

  /**
   * A token minted from the deployment's own key, where it has one.
   *
   * See `WeatherKitCredential`: an app cannot carry the key this is signed
   * with, so a deployment serving its own app configures the key here and its
   * callers send nothing. A caller who does send a token still wins — the
   * service only falls back to this.
   */
  credential(): string | undefined {
    return this.signer?.token();
  }

  /**
   * Never called: `info.geocoding` is false and the service refuses a place
   * name before it gets here. Implemented because the contract asks for it, and
   * answering nothing is the truthful answer.
   */
  async locate(): Promise<GeocodedPlace | undefined> {
    return undefined;
  }

  async read(request: WeatherRequest): Promise<ProviderReading> {
    const {
      latitude,
      longitude,
      language,
      units,
      apiKey,
      country,
      includeForecast,
      includeAlerts,
      includeUv,
    } = request;

    // Warnings are the one dataset that has to be asked for: it is what the
    // country code is for, and leaving it out of the URL keeps it out of the
    // cached document as well, so a caller who did not ask for warnings is
    // never served a body that holds them.
    const dataSets = [
      'currentWeather',
      'forecastDaily',
      'forecastHourly',
      ...(includeAlerts ? ['weatherAlerts'] : []),
    ];

    const scope = includeAlerts && country ? country.toUpperCase() : '';
    const query = new URLSearchParams({
      dataSets: dataSets.join(','),
      timezone: this.zone(longitude),
      ...(scope ? { countryCode: scope } : {}),
    });

    const [body, credit] = await Promise.all([
      this.cacheManager.wrap(
        // The token is deliberately absent from the key, as the other
        // provider's key is: two callers standing in the same cell are asking
        // the same question, and the answer does not depend on whose quota
        // paid for it.
        //
        // The language is absent too, unless the warnings are — they are the
        // only localised thing in the document, since the conditions arrive as
        // an English enum and are put into words here. Keyed by it regardless,
        // every language would fetch and hold its own byte-identical copy.
        `apple/${latitude},${longitude}/${
          includeAlerts ? `alerts/${language}/${scope}` : 'plain'
        }`,
        () =>
          upstreamGet<WeatherKitResponse>(
            this.httpService,
            `${API_URL}/${this.tag(language)}/${latitude}/${longitude}?${query}`,
            this.info.name,
            { headers: { Authorization: `Bearer ${apiKey}` } },
          ),
        // Apple states when the document stops being true, which beats
        // guessing at how often it moves. Floored, because a document that
        // arrives already expired would otherwise be fetched again by the very
        // next request.
        (value) => this.ttl(value),
      ),
      this.credit(language),
    ]);

    const now = Date.now() / 1000;
    const day = this.today(body.forecastDaily?.days ?? [], now);
    // Both consumers are conditional, so an answer that wants neither the
    // forecast nor the sun does not pay to walk the hours at all.
    const hours =
      includeForecast || includeUv
        ? this.hours(body.forecastHourly?.hours ?? [], now)
        : [];
    const alerts = includeAlerts
      ? inForce(this.alerts(body.weatherAlerts?.alerts ?? []), now)
      : undefined;

    return {
      location: {
        // Apple names no place and no country: WeatherKit does no geocoding in
        // either direction. Left empty rather than filled from the coordinates,
        // which would be a guess dressed as an observation. A caller who wants
        // the town named asks by `location` through a provider that geocodes,
        // or sends the country itself.
        name: '',
        country: country?.toUpperCase() ?? '',
        latitude,
        longitude,
        timezoneOffset: this.hoursEast(longitude) * 3600,
      },
      current: this.current(body, day, hours, units, includeUv, now),
      forecast: includeForecast ? this.steps(hours, units) : [],
      ...(alerts ? { alerts, alertScope: 'area' as const } : {}),
      credit: {
        ...credit,
        // Apple's own legal page, named by the document rather than by us, so
        // that the link a client is required to draw is the one Apple is
        // currently pointing at.
        ...(body.currentWeather?.metadata?.attributionURL
          ? { licence: body.currentWeather.metadata.attributionURL }
          : {}),
      },
      provides: [
        'weather',
        ...((includeForecast ? ['forecast'] : []) as DataKind[]),
        ...((alerts ? ['alerts'] : []) as DataKind[]),
        ...((includeUv ? ['uv'] : []) as DataKind[]),
      ],
    };
  }

  /**
   * The Apple Weather mark, which WeatherKit's terms require shown beside the
   * data rather than merely named.
   *
   * Its own endpoint, unauthenticated — the artwork is public branding, not
   * weather — and localised, which is why it is keyed by language and fetched
   * alongside the reading rather than baked in as constants. Held for a week:
   * it changes on the timescale of a rebrand.
   *
   * Swallowed on failure. A client that cannot draw the mark is a problem, but
   * failing the whole reading because a branding manifest did not load is a
   * worse one, and the legal link still travels either way.
   */
  private async credit(
    language: string,
  ): Promise<Pick<Attribution, 'logo'> | undefined> {
    const branding = await this.cacheManager
      .wrap(
        `apple/attribution/${language}`,
        () =>
          upstreamGet<AttributionResponse>(
            this.httpService,
            `${ATTRIBUTION_URL}/${this.tag(language)}`,
            this.info.name,
          ),
        TTL.attribution,
      )
      .catch(() => undefined);
    if (!branding) return undefined;

    const image = (appearance: string): AttributionImage => ({
      // The paths arrive partial, so they are made whole here rather than by
      // every client that has to draw them.
      x1: `${HOST}${branding[`${appearance}@1x`] ?? ''}`,
      x2: `${HOST}${branding[`${appearance}@2x`] ?? ''}`,
      x3: `${HOST}${branding[`${appearance}@3x`] ?? ''}`,
    });

    return {
      logo: {
        light: image('logoLight'),
        dark: image('logoDark'),
        square: image('logoSquare'),
      },
    };
  }

  /**
   * The language tag as Apple spells it, undoing the service's normalisation.
   *
   * The service lowercases and underscores because that is how OpenWeather
   * spells a tag; WeatherKit wants BCP 47, where the region is upper case and
   * the separator is a hyphen. The normalised form is what the cache is keyed
   * by, so the conversion happens here at the edge and nowhere earlier.
   */
  private tag(language: string): string {
    const [base, region] = language.split('_');
    return region ? `${base}-${region.toUpperCase()}` : base;
  }

  /**
   * A time zone for the cell, worked out from its longitude.
   *
   * WeatherKit requires one — it is what rolls the hourly forecast up into
   * days, so it decides which hours count as today's high and low — and a
   * coordinate does not carry one. This is the solar zone: right to the hour
   * across most of the world, and wrong by up to two where a country has
   * chosen a clock its longitude does not justify, or is on summer time. The
   * cost of being wrong is a daily high taken from a window shifted by an hour
   * or two, not a wrong temperature.
   *
   * `Etc/GMT` counts the other way round from everything else: `Etc/GMT-1` is
   * one hour *ahead* of UTC. Hence the inverted sign.
   */
  private zone(longitude: number): string {
    const hours = this.hoursEast(longitude);
    if (hours === 0) return 'Etc/GMT';
    return `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
  }

  /**
   * Whole hours east of Greenwich. The `|| 0` is not decoration: rounding a
   * small negative longitude gives negative zero, which would travel out as
   * `-0` in the response and compare unequal to the nought a client expects.
   */
  private hoursEast(longitude: number): number {
    return Math.round(longitude / 15) || 0;
  }

  /**
   * How long to hold the document, from Apple's own expiry.
   *
   * Clamped at both ends: a document that arrives already stale would be
   * refetched by the next request through, and one claiming to stand for a day
   * would outlive the observation it carries.
   */
  private ttl(body: WeatherKitResponse): number {
    const expires = seconds(body.currentWeather?.metadata?.expireTime);
    if (expires === undefined) return TTL.current;
    const remaining = expires * 1000 - Date.now();
    return Math.min(Math.max(remaining, TTL_FLOOR), TTL.forecast);
  }

  /**
   * The day the reading falls in, which is not always the first one listed.
   *
   * A request made late in the evening local time can be answered with a
   * daily forecast that already starts on tomorrow, and taking `days[0]` on
   * faith would report tomorrow's high as today's.
   */
  private today(days: AppleDay[], now: number): AppleDay | undefined {
    const covering = days.find((day) => {
      const start = seconds(day.forecastStart);
      const end = seconds(day.forecastEnd);
      return (
        start !== undefined && end !== undefined && start <= now && now < end
      );
    });
    return covering ?? days[0];
  }

  /** The hours still ahead, which is what a forecast means. */
  private hours(hours: AppleHour[], now: number): AppleHour[] {
    return hours.filter((hour) => {
      const start = seconds(hour.forecastStart);
      return start !== undefined && start >= now - 3600;
    });
  }

  private steps(hours: AppleHour[], units: WeatherUnits): ForecastStep[] {
    return hours.slice(0, FORECAST_STEPS).map((hour) => {
      const temperature = hour.temperature ?? 0;
      return {
        time: seconds(hour.forecastStart) ?? 0,
        temperature: this.degrees(temperature, units),
        feelsLike: this.degrees(hour.temperatureApparent ?? temperature, units),
        ...describe(hour.conditionCode, hour.daylight ?? true),
        precipitation: hour.precipitationChance ?? 0,
      };
    });
  }

  private current(
    body: WeatherKitResponse,
    day: AppleDay | undefined,
    hours: AppleHour[],
    units: WeatherUnits,
    includeUv: boolean,
    now: number,
  ): CurrentWeather {
    const observation = body.currentWeather ?? {};
    const temperature = observation.temperature ?? 0;

    return {
      temperature: this.degrees(temperature, units),
      feelsLike: this.degrees(
        observation.temperatureApparent ?? temperature,
        units,
      ),
      // Apple states the day's range outright, so unlike OpenWeather it does
      // not have to be read off the forecast steps — and turning the forecast
      // off does not cost it. Only a missing daily forecast collapses it to
      // the observation.
      high: this.degrees(day?.temperatureMax ?? temperature, units),
      low: this.degrees(day?.temperatureMin ?? temperature, units),
      ...describe(observation.conditionCode, observation.daylight ?? true),
      // Apple reports both of these as a fraction; the response contract, and
      // every client already drawing OpenWeather, is in per cent.
      humidity: this.percent(observation.humidity),
      // Millibars and hectopascals are the same unit under two names.
      pressure: Math.round(observation.pressure ?? 0),
      windSpeed: this.wind(observation.windSpeed ?? 0, units),
      windDirection: Math.round(observation.windDirection ?? 0),
      cloudiness: this.percent(observation.cloudCover),
      sunrise: seconds(day?.sunrise) ?? 0,
      sunset: seconds(day?.sunset) ?? 0,
      observedAt: seconds(observation.asOf) ?? Math.floor(Date.now() / 1000),
      // No air quality: WeatherKit publishes five data sets and none of them
      // is one, so the field stays off rather than being zeroed.
      ...(includeUv ? this.uv(observation.uvIndex, hours, now) : {}),
    };
  }

  /**
   * The sun's part of the reading, which for this provider is not a second
   * service.
   *
   * Open-Meteo exists in this endpoint because OpenWeather's free plan carries
   * no UV index. Apple's does, in the same document already fetched, so a
   * caller asking Apple for the UV index adds no third party to their request
   * and no call to their quota — and the service does not go looking for one.
   *
   * The threshold logic is Open-Meteo's, deliberately: the two providers should
   * not disagree about what "until" means.
   */
  private uv(
    uvIndex: number | undefined,
    hours: AppleHour[],
    now: number,
  ): Pick<CurrentWeather, 'uv' | 'uvProtectionUntil'> {
    return (
      uvReading(uvIndex, () =>
        // The first hour ahead that is back under the threshold, not the last
        // one over it: the sun comes down once a day, and on a longer window
        // the last hour over the line is tomorrow lunchtime. Searched rather
        // than mapped, so a match in the first hour costs one parse.
        seconds(
          hours.find(
            (hour) =>
              (seconds(hour.forecastStart) ?? 0) > now &&
              (hour.uvIndex ?? 0) < UV_PROTECTION,
          )?.forecastStart,
        ),
      ) ?? {}
    );
  }

  /**
   * Apple's warnings, in the shape the European ones already come back in.
   *
   * Two things are missing next to a CAP warning from MeteoAlarm, and both are
   * deliberate. There is no colour band, because Apple does not publish one —
   * `level` stays off and the warning ranks by its CAP severity instead, which
   * is what the shared ladder falls back to. And there is no long description
   * or instruction: the summary Apple sends with the reading carries the
   * event's name and a link, and the full text is a second request per warning
   * against the caller's quota. The link travels in `url` so a client can
   * follow it.
   */
  private alerts(alerts: AppleAlert[]): WeatherAlert[] {
    return alerts
      .filter((alert): alert is AppleAlert & { id: string } =>
        Boolean(alert.id),
      )
      .map((alert) => {
        const event = alert.description ?? '';
        const expires =
          seconds(alert.eventEndTime) ?? seconds(alert.expireTime);

        return {
          id: alert.id,
          event,
          headline: event,
          description: event,
          severity: alert.severity ?? 'Unknown',
          urgency: alert.urgency ?? 'Unknown',
          certainty: alert.certainty ?? 'Unknown',
          onset:
            seconds(alert.eventOnsetTime) ??
            seconds(alert.effectiveTime) ??
            seconds(alert.issuedTime) ??
            0,
          ...(expires === undefined ? {} : { expires }),
          areas: alert.areaName ? [alert.areaName] : [],
          regions: alert.areaId ? [{ code: alert.areaId, type: AREA_ID }] : [],
          sender: alert.source ?? '',
          ...(alert.detailsUrl ? { url: alert.detailsUrl } : {}),
        };
      });
  }

  /**
   * Apple answers in metric and only in metric, so the units the caller asked
   * for are made here rather than asked for upstream — which is also why the
   * cached document is not keyed by them: one fetch serves all three.
   */
  private degrees(celsius: number, units: WeatherUnits): number {
    if (units === 'imperial') return this.round((celsius * 9) / 5 + 32, 1);
    if (units === 'standard') return this.round(celsius + 273.15, 1);
    return this.round(celsius, 1);
  }

  /** Kilometres per hour into the unit the response promises for each system. */
  private wind(kmh: number, units: WeatherUnits): number {
    if (units === 'imperial') return this.round(kmh / 1.609344, 2);
    return this.round(kmh / 3.6, 2);
  }

  private percent(fraction: number | undefined): number {
    return Math.round((fraction ?? 0) * 100);
  }

  private round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }
}
