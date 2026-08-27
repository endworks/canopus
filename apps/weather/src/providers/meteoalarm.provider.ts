import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { AlertRegion, WeatherAlert } from '../models/weather.interface';
import { TTL } from '../utils';
import { upstreamGet } from './upstream';

const API_URL = 'https://feeds.meteoalarm.org/api/v1/warnings';

/** The one scheme the region atlas is drawn in, and so the one it can place. */
export const EMMA = 'EMMA_ID';

/**
 * The countries EUMETNET publishes for, and the slug each feed is named by.
 *
 * The feed is addressed by country name rather than by code, so this is the
 * one place a code becomes a URL. A country absent from this map is a country
 * MeteoAlarm does not cover — most of the world — and asking is answered with
 * no alerts rather than with an error, because there being no European warning
 * service in Peru is not a fault of the request.
 */
const FEEDS: Record<string, string> = {
  AT: 'austria',
  BA: 'bosnia-herzegovina',
  BE: 'belgium',
  BG: 'bulgaria',
  CH: 'switzerland',
  CY: 'cyprus',
  CZ: 'czechia',
  DE: 'germany',
  DK: 'denmark',
  EE: 'estonia',
  ES: 'spain',
  FI: 'finland',
  FR: 'france',
  GB: 'united-kingdom',
  GR: 'greece',
  HR: 'croatia',
  HU: 'hungary',
  IE: 'ireland',
  IL: 'israel',
  IS: 'iceland',
  IT: 'italy',
  LT: 'lithuania',
  LU: 'luxembourg',
  LV: 'latvia',
  MD: 'moldova',
  ME: 'montenegro',
  MK: 'republic-of-north-macedonia',
  MT: 'malta',
  NL: 'netherlands',
  NO: 'norway',
  PL: 'poland',
  PT: 'portugal',
  RO: 'romania',
  RS: 'serbia',
  SE: 'sweden',
  SI: 'slovenia',
  SK: 'slovakia',
  UA: 'ukraine',
};

/**
 * The bands a warning can be at, by either of the two names it has.
 *
 * MeteoAlarm's colour and CAP's severity are meant to be the same ladder, and
 * across the feed they are not: Spain files yellow as Moderate, Germany files
 * it as Minor. The colour is the one MeteoAlarm normalises across its members
 * and draws its maps in, so it is the one that ranks a warning here — with the
 * severity read only where an office sent no colour at all. Both spellings are
 * accepted from a caller, because both are in the response.
 */
const BANDS: Record<string, number> = {
  green: 1,
  minor: 1,
  yellow: 2,
  moderate: 2,
  orange: 3,
  severe: 3,
  red: 4,
  extreme: 4,
};

/** What a caller may send as a safety floor, for the error that lists them. */
export const SAFETY_BANDS = Object.keys(BANDS);

/** The `EMMA_ID` codes a warning is scoped by, which are the placeable ones. */
export const emmaCodes = (alert: { regions: AlertRegion[] }): string[] =>
  alert.regions
    .filter((region) => region.type === EMMA)
    .map((region) => region.code);

/** Loosely, for matching a place name a caller typed: no case, no accents. */
const plain = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

type CapParameter = { valueName?: string; value?: string };

type CapGeocode = { valueName?: string; value?: string };

type CapInfo = {
  language?: string;
  event?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  onset?: string;
  expires?: string;
  senderName?: string;
  web?: string;
  area?: { areaDesc?: string; geocode?: CapGeocode[] }[];
  parameter?: CapParameter[];
};

type CapAlert = {
  identifier?: string;
  status?: string;
  scope?: string;
  /** Space-separated `sender,identifier,sent` triples this message replaces. */
  references?: string;
  info?: CapInfo[];
};

type WarningsResponse = { warnings?: { alert?: CapAlert }[] };

/** What a caller asked to be shown, out of a country's warnings. */
export interface AlertFilter {
  /** Least band worth returning, as a colour or a CAP severity. */
  safety?: string;
  /** A region name the caller typed, matched loosely against `areas`. */
  area?: string;
  /** The region codes the cell falls in; empty means it could not be placed. */
  regions?: string[];
}

/**
 * The warnings, which are nobody's to sell.
 *
 * MeteoAlarm is EUMETNET's aggregator: the national met offices issue the
 * warnings, it collects them as CAP and publishes them without a key. That
 * makes it a third party in an endpoint that already has two, and it is opt-in
 * for the same reason the UV index is — a caller who does not want one does
 * not send the header. The offices are credited by name on each warning; the
 * aggregator is credited in `attribution`.
 */
@Injectable()
export class MeteoAlarmProvider {
  readonly name = 'MeteoAlarm';
  readonly url = 'https://meteoalarm.org/';

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  /** Whether there is a feed for this country at all. */
  covers(country?: string): boolean {
    return Boolean(country && FEEDS[country.toUpperCase()]);
  }

  /**
   * Every warning in force over a country, most severe first.
   *
   * Cached already narrowed and already in one language rather than as the
   * feed came: Spain answers with two megabytes covering five days, of which
   * the eighty-odd warnings still in force are a fraction. Holding the raw
   * document per country would cost tens of megabytes to serve a list a client
   * can read.
   */
  async read(
    country: string,
    language: string,
  ): Promise<WeatherAlert[] | undefined> {
    const feed = FEEDS[country.toUpperCase()];
    if (!feed) return undefined;

    return this.cacheManager.wrap(
      `meteoalarm/${feed}/${language}`,
      async () => {
        const body = await upstreamGet<WarningsResponse>(
          this.httpService,
          `${API_URL}/feeds-${feed}`,
          this.name,
        );
        return this.alerts(body, language);
      },
      TTL.alerts,
    );
  }

  private alerts(body: WarningsResponse, language: string): WeatherAlert[] {
    const warnings = (body.warnings ?? [])
      .map((warning) => warning.alert)
      .filter((alert): alert is CapAlert => Boolean(alert?.identifier));

    // An office updating a warning issues a new message naming the ones it
    // replaces, and the feed carries both. Without this the same storm is
    // listed twice, at whichever two levels it has been at today.
    const superseded = new Set(
      warnings.flatMap((alert) =>
        (alert.references ?? '')
          .split(/\s+/)
          .map((reference) => reference.split(',')[1])
          .filter(Boolean),
      ),
    );

    const now = Date.now() / 1000;

    return (
      warnings
        .filter(
          (alert) =>
            alert.status === 'Actual' &&
            alert.scope === 'Public' &&
            !superseded.has(alert.identifier as string),
        )
        .map((alert) => this.alert(alert, language))
        .filter((alert): alert is WeatherAlert => alert !== undefined)
        // The feed is a rolling window several days wide, so most of what it
        // carries has already happened. A warning with no end is kept: some
        // offices issue those, and an absent expiry is not a lapsed one.
        .filter((alert) => alert.expires === undefined || alert.expires > now)
        .sort((a, b) => this.rank(b) - this.rank(a) || a.onset - b.onset)
    );
  }

  /**
   * The warnings a caller asked to see, out of the ones in force.
   *
   * Every filter here narrows a list already fetched and cached whole, so a
   * caller asking only for red warnings in their own valley costs the same one
   * national call as a caller asking for all of them.
   */
  filter(
    alerts: WeatherAlert[],
    { safety, area, regions }: AlertFilter,
  ): WeatherAlert[] {
    const floor = safety ? BANDS[plain(safety)] : undefined;
    const wanted = area ? plain(area) : undefined;
    // An empty set means the atlas could not place the cell, which is not the
    // same as placing it nowhere: the warnings stay national rather than
    // vanishing. Only a non-empty set narrows.
    const covering = regions?.length ? new Set(regions) : undefined;

    return alerts.filter((alert) => {
      if (floor !== undefined && this.rank(alert) < floor) return false;
      if (covering && !emmaCodes(alert).some((code) => covering.has(code))) {
        return false;
      }
      if (
        wanted &&
        !alert.areas.some((name) => plain(name).includes(wanted)) &&
        !alert.regions.some((region) => plain(region.code) === wanted)
      ) {
        return false;
      }
      return true;
    });
  }

  /** Where a warning sits on the ladder: its colour first, its severity after. */
  private rank(alert: WeatherAlert): number {
    return (
      (alert.level ? BANDS[plain(alert.level)] : undefined) ??
      BANDS[plain(alert.severity)] ??
      0
    );
  }

  private alert(alert: CapAlert, language: string): WeatherAlert | undefined {
    const info = this.info(alert.info ?? [], language);
    if (!info?.event) return undefined;

    const onset = this.seconds(info.onset);
    if (onset === undefined) return undefined;

    return {
      id: alert.identifier as string,
      event: info.event,
      headline: info.headline ?? info.event,
      description: info.description ?? '',
      ...(info.instruction ? { instruction: info.instruction } : {}),
      severity: info.severity ?? 'Unknown',
      // '3; orange; Severe' and '10; Rain' — the middle of the first and the
      // tail of the second are the parts worth a field of their own.
      ...this.awareness(info.parameter ?? []),
      urgency: info.urgency ?? 'Unknown',
      certainty: info.certainty ?? 'Unknown',
      onset,
      ...this.expiry(info.expires),
      areas: (info.area ?? [])
        .map((area) => area.areaDesc)
        .filter((name): name is string => Boolean(name)),
      regions: (info.area ?? []).flatMap((area) =>
        (area.geocode ?? [])
          .filter((code) => code.value && code.valueName)
          .map((code) => ({
            code: code.value as string,
            type: code.valueName as string,
          })),
      ),
      sender: info.senderName ?? '',
      ...(info.web ? { url: info.web } : {}),
    };
  }

  /**
   * The block written in the language asked for, or the English one.
   *
   * Matched on the language alone rather than on the whole tag: the same feed
   * spells English `en-GB` in Spain and `en` in Germany, and a caller asking
   * for `pt_br` is better served Portugal's Portuguese than nothing. English
   * is the fallback because every office in the feed publishes it.
   */
  private info(infos: CapInfo[], language: string): CapInfo | undefined {
    const wanted = language.slice(0, 2).toLowerCase();
    const spoken = (info: CapInfo) =>
      (info.language ?? '').slice(0, 2).toLowerCase();
    return (
      infos.find((info) => spoken(info) === wanted) ??
      infos.find((info) => spoken(info) === 'en') ??
      infos[0]
    );
  }

  private awareness(
    parameters: CapParameter[],
  ): Pick<WeatherAlert, 'level' | 'awareness'> {
    const part = (name: string, index: number) =>
      parameters
        .find((parameter) => parameter.valueName === name)
        ?.value?.split(';')
        [index]?.trim();

    const level = part('awareness_level', 1);
    const awareness = part('awareness_type', 1);
    return { ...(level ? { level } : {}), ...(awareness ? { awareness } : {}) };
  }

  private expiry(expires?: string): Pick<WeatherAlert, 'expires'> {
    const seconds = this.seconds(expires);
    return seconds === undefined ? {} : { expires: seconds };
  }

  /** A CAP timestamp, which carries its own offset, as an instant. */
  private seconds(time?: string): number | undefined {
    if (!time) return undefined;
    const parsed = Date.parse(time);
    return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
  }
}
