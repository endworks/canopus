import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { WeatherAlert } from '../models/weather.interface';
import { seconds, TTL } from '../utils';
import { inForce } from './alert-filter';
import { upstreamGet } from './upstream';

const API_URL = 'https://feeds.meteoalarm.org/api/v1/warnings';

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
  /** EUMETNET asks that reuse of the feed points back at its terms. */
  readonly licence = 'https://meteoalarm.org/en/live/page/disclaimer';

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
        // The feed is a rolling window several days wide, so most of what it
        // carries has already happened; narrowed to what still stands before
        // it is held, since that is what every reader of the cache wants.
        return inForce(this.alerts(body, language), Date.now() / 1000);
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

    return warnings
      .filter(
        (alert) =>
          alert.status === 'Actual' &&
          alert.scope === 'Public' &&
          !superseded.has(alert.identifier as string),
      )
      .map((alert) => this.alert(alert, language))
      .filter((alert): alert is WeatherAlert => alert !== undefined);
  }

  private alert(alert: CapAlert, language: string): WeatherAlert | undefined {
    const info = this.info(alert.info ?? [], language);
    if (!info?.event) return undefined;

    const onset = seconds(info.onset);
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
    const lapses = seconds(expires);
    return lapses === undefined ? {} : { expires: lapses };
  }
}
