import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AlertScope,
  Attribution,
  DataKind,
  ProviderInfo,
  WeatherAlert,
  WeatherPayload,
  WeatherResponse,
  WeatherUnits,
} from '../models/weather.interface';
import {
  emmaCodes,
  filterAlerts,
  plain,
  SAFETY_BANDS,
} from '../providers/alert-filter';
import { ClientKeys } from '../providers/client-keys';
import { MeteoAlarmProvider } from '../providers/meteoalarm.provider';
import { OpenMeteoGeocoder } from '../providers/open-meteo-geocoder';
import { OsmReverseGeocoder } from '../providers/osm-reverse-geocoder';
import { RegionAtlas } from '../providers/region-atlas';
import { AirSources } from '../providers/air-sources';
import { OpenMeteoUvProvider } from '../providers/open-meteo-uv.provider';
import { WEATHER_PROVIDERS } from '../providers/registry';
import {
  ProviderReading,
  WeatherProvider,
} from '../providers/weather-provider';
import { roundCoordinate } from '../utils';

const DEFAULT_PROVIDER = 'openweather';
const UNITS: WeatherUnits[] = ['metric', 'imperial', 'standard'];

/** A country's warnings once narrowed, and what they were narrowed to. */
interface Warnings {
  alerts: WeatherAlert[];
  scope: AlertScope;
}

/** The cell a request is about, and whether a name had to be resolved to it. */
interface Cell {
  latitude: number;
  longitude: number;
  name?: string;
  country?: string;
  geocoded: boolean;
  /** Whether the name was resolved by someone other than the provider. */
  borrowed?: boolean;
}

@Injectable()
export class WeatherService {
  constructor(
    @Inject(WEATHER_PROVIDERS)
    private readonly providers: Map<string, WeatherProvider>,
    private readonly uvProvider: OpenMeteoUvProvider,
    private readonly air: AirSources,
    private readonly alertProvider: MeteoAlarmProvider,
    private readonly atlas: RegionAtlas,
    private readonly geocoder: OpenMeteoGeocoder,
    private readonly reverseGeocoder: OsmReverseGeocoder,
    private readonly clients: ClientKeys,
  ) {
    // A credential the deployment pays for, reachable by anyone who finds the
    // URL, is the mistake this refuses to boot into. Normally unreachable: a
    // configured WeatherKit key derives a client key of its own, so this only
    // fires where a provider is managed by some means that supplies neither.
    const managed = [...this.providers.values()].filter(
      (provider) => provider.info.managed,
    );
    if (managed.length > 0 && !this.clients.configured) {
      throw new Error(
        `A credential is configured for ${managed
          .map((provider) => provider.info.name)
          .join(', ')}, but no client key is configured or derivable — ` +
          'anyone reaching this service could spend that quota. Set ' +
          "WEATHER_CLIENT_KEYS, or unset the provider's credential.",
      );
    }
  }

  listProviders(): ProviderInfo[] {
    return [...this.providers.values()].map((provider) => provider.info);
  }

  async getWeather(payload: WeatherPayload): Promise<WeatherResponse> {
    const provider = this.pick(payload.provider);
    // The caller's own key first: a caller spending their own quota needs no
    // permission from us, and a service configured with a WeatherKit key of
    // its own should still let them.
    const apiKey = payload.apiKey?.trim() || this.managed(provider, payload);
    if (!apiKey) {
      throw new UnauthorizedException(
        `Send your own ${provider.info.name} key in the X-Weather-Api-Key header (${provider.info.apiKeyUrl})`,
      );
    }

    const language = this.language(payload.language);
    const units = this.units(payload.units);
    this.safety(payload.safety);
    const country = this.country(payload.country);
    const cell = await this.locate(
      provider,
      payload,
      apiKey,
      language,
      country,
    );

    // Two rows the chosen provider may already carry. Where it does, the
    // service does not go looking for a second source: Apple ships the
    // warnings and the UV index in the same document as the temperature, and
    // asking Open-Meteo and MeteoAlarm anyway would add two parties to the
    // request to be told what is already in hand.
    const ownAlerts = Boolean(payload.includeAlerts && provider.info.alerts);
    const ownUv = Boolean(payload.includeUv && provider.info.uv);
    // The air asks the other way round from the sun: on unless refused, because
    // it has always come back with the reading and a caller who never sent a
    // header for it should not lose it because this service grew one.
    //
    // Refused, nobody is asked at all — not the provider's own endpoint, not
    // the city network, not the model behind it. That is three parties saved
    // for a caller who told us they will not draw the field, which is the one
    // shape of waste a header can fix from here.
    const wantsAir = payload.includeAirQuality ?? true;

    // Started here rather than inside the gather below so it flies alongside
    // the reading. Warnings are national, so the country picks the feed — and
    // the country is known this early only when a name was geocoded or the
    // caller said so. When it is not, the reading itself has to name it, and
    // the call is necessarily the slower one.
    const feed =
      ownAlerts || !cell.country
        ? undefined
        : this.alerts(payload, cell.country, language, cell);

    // And the air, which unlike the sun is not settled by asking who carries
    // it. Every provider's own is modelled off the same continental runs, and
    // a city that measures its own is simply nearer the truth than any of them
    // — so the instruments are asked first, alone, and before anyone else is
    // asked anything. Where one answers, nobody else is asked at all: not the
    // model, and not the weather provider, whose air is a second call against
    // the caller's own key for a number this one would overrule before the
    // reader ever saw it.
    //
    // The one thing paid for that is the order. It is awaited rather than
    // gathered with the reading, so inside such a city a cold cache costs one
    // request in sequence — one an hour, for a document covering the whole
    // network — and the national feed above is already in flight across it.
    // Everywhere else it costs nothing at all: `covers` is a bounds check, and
    // answers without a request.
    const measured = wantsAir
      ? await this.air
          .measured(cell.latitude, cell.longitude)
          .catch(() => undefined)
      : undefined;
    // Which leaves the provider's own air worth asking for only where no
    // instrument answered — the case its model was always the fallback for.
    const askForAir = wantsAir && measured === undefined;

    // Whether the place will have a name is knowable before anything is asked:
    // a coordinate was sent, and this provider does no geocoding, so nothing in
    // the reading about to come back will say where it is about. Started here
    // rather than after it, so naming the place costs no round trip of its own.
    //
    // And only where the caller says they cannot name it themselves. A phone
    // reverses its own coordinates with the geocoder it already carries — no
    // key, no credit, no request to anybody — so asking a map on its behalf
    // would add a party and a line of attribution to every reading in order to
    // answer a question that had already been answered for free.
    const unnamed =
      Boolean(payload.includeLocationName) &&
      !cell.geocoded &&
      !provider.info.geocoding;

    const [reading, uv, modelledAir, place] = await Promise.all([
      provider.read({
        apiKey,
        latitude: cell.latitude,
        longitude: cell.longitude,
        language,
        units,
        country: cell.country,
        // The one flag that defaults on: the day's high and low are read off
        // the forecast, so a caller who says nothing keeps the answer they
        // have always had.
        includeForecast: payload.includeForecast ?? true,
        includeAlerts: ownAlerts,
        includeUv: ownUv,
        includeAirQuality: askForAir,
      }),
      // Swallowed rather than awaited with the rest: the sun is one field from
      // a second service, and that service being down should cost the field
      // rather than the temperature.
      payload.includeUv && !ownUv
        ? this.uvProvider
            .read(cell.latitude, cell.longitude)
            .catch(() => undefined)
        : undefined,
      // Swallowed for the same reason: the air is one field, and a second
      // service being down should cost that field rather than the temperature.
      // Asked only where the provider carries no air of its own — a model has
      // nothing to tell a model, and the measurement that would have outranked
      // both was already asked for above.
      askForAir && !provider.info.airQuality
        ? this.air
            .modelled(cell.latitude, cell.longitude)
            .catch(() => undefined)
        : undefined,
      // Swallowed like the two above and for the same reason: a name is one
      // field, and the service that answers it being down should cost the name
      // rather than the temperature — which is exactly what came back before
      // anybody was asked at all.
      unnamed
        ? this.reverseGeocoder
            .reverse(cell.latitude, cell.longitude, language)
            .catch(() => undefined)
        : undefined,
    ]);
    // Whoever answered instead of the provider, in the order they rank.
    const borrowedAir = measured ?? modelledAir;

    const warnings = ownAlerts
      ? this.issued(reading, payload)
      : await (feed ??
          this.alerts(payload, reading.location.country, language, cell));
    // The warnings actually on show, or nothing. Nobody is credited for an
    // empty list — not the feed that said so, not a provider that issued its
    // own — because a credit beside no data has a client drawing a met office,
    // a licence link and a delay disclaimer for a reader who was told nothing.
    const shown = warnings?.alerts.length ? warnings.alerts : undefined;

    // What the provider answered but the response does not show as its own: the
    // air where somebody else's measurement displaced it, because two sources
    // credited for one field would have the reader believe the number came from
    // whichever they looked at first, and the warnings where none survived the
    // narrowing.
    const withheld = new Set<DataKind>();
    if (borrowedAir !== undefined) withheld.add('airQuality');
    if (shown === undefined) withheld.add('alerts');

    const attribution: Attribution[] = [
      {
        name: provider.info.name,
        url: provider.info.url,
        provides: [
          ...reading.provides.filter((kind) => !withheld.has(kind)),
          ...((cell.geocoded && !cell.borrowed
            ? ['geocoding']
            : []) as DataKind[]),
        ],
        // Whatever this source's terms ask for beyond its name — a licence to
        // link, a mark to draw. Only the provider knows.
        ...(reading.credit ?? {}),
      },
    ];
    // Whoever placed this reading, where it was not the weather provider. The
    // two directions are never both asked — a request either named a place or
    // sent a coordinate — so this is one line either way, and there is none at
    // all where nothing came back: a lookup that found sea owes nobody.
    const placedBy = cell.borrowed
      ? this.geocoder
      : place
        ? this.reverseGeocoder
        : undefined;
    if (placedBy) {
      attribution.push({
        name: placedBy.name,
        url: placedBy.url,
        licence: placedBy.licence,
        notice: placedBy.notice,
        provides: ['geocoding'],
      });
    }
    if (uv) {
      attribution.push({
        name: this.uvProvider.name,
        url: this.uvProvider.url,
        licence: this.uvProvider.licence,
        notice: this.uvProvider.notice,
        provides: ['uv'],
      });
    }
    // Whichever source actually answered, which is no longer knowable in
    // advance: a city's own network speaks for its own few square kilometres
    // and the model speaks for everywhere else, and the reader is owed the one
    // that measured their air rather than the one that usually does.
    //
    // Merged where the sun came from the same place — Open-Meteo answers both,
    // and they are two separate answers that happen to come from one company,
    // so one line credited for both rather than the company named twice.
    if (borrowedAir !== undefined) {
      const { source } = borrowedAir;
      const same = attribution.find((credited) => credited.url === source.url);
      if (same) same.provides = [...same.provides, 'airQuality'];
      else
        attribution.push({
          name: source.name,
          url: source.url,
          licence: source.licence,
          notice: source.notice,
          disclaimer: borrowedAir.disclaimer,
          provides: ['airQuality'],
        });
    }
    // Credited only for warnings actually on show, like every field above. An
    // empty `alerts` is still an answer — the feed was asked and said nothing
    // is in force — but it shows the reader nothing of MeteoAlarm's to credit.
    // A provider that issued the warnings itself is already credited for them
    // in its own line.
    if (shown && !ownAlerts) {
      // MeteoAlarm's terms split the credit by how far the warnings reach:
      // information from a single country must name that country's own met
      // office, and only information spanning more than one is credited to
      // EUMETNET. One country's feed is asked at a time, so the offices that
      // issued the warnings actually on show are the ones owed the line.
      const senders = [
        ...new Set(shown.map((alert) => alert.sender).filter(Boolean)),
      ];
      attribution.push({
        name: this.alertProvider.name,
        url: this.alertProvider.url,
        licence: this.alertProvider.licence,
        notice: senders.length ? senders.join(', ') : this.alertProvider.notice,
        disclaimer: this.alertProvider.disclaimer,
        provides: ['alerts'],
      });
    }

    return {
      provider: provider.info.id,
      units,
      location: {
        ...reading.location,
        // The name the caller asked about beats the one the provider's nearest
        // station answers with: a cell is a kilometre across, and on its edge
        // that station belongs to the next village along.
        ...(cell.geocoded ? { name: cell.name, country: cell.country } : {}),
        // And where nobody named it, whoever could. Only the name is taken:
        // the country was already settled by what the caller sent or where the
        // atlas placed them, and that is the one the warnings were scoped by —
        // so a map that disagrees with it must not quietly move the response's
        // account of which country this is. Filled where there was nothing.
        ...(place
          ? {
              name: place.name,
              country: reading.location.country || place.country,
            }
          : {}),
      },
      current: {
        ...reading.current,
        ...(uv ?? {}),
        // Whichever grade won: the provider's own, or a measurement from a
        // source near enough to overrule it.
        ...(borrowedAir !== undefined ? { airQuality: borrowedAir.index } : {}),
      },
      forecast: reading.forecast,
      ...(warnings
        ? { alerts: warnings.alerts, alertScope: warnings.scope }
        : {}),
      attribution,
      lastUpdated: new Date(reading.current.observedAt * 1000).toISOString(),
    };
  }

  /**
   * The deployment's own credential, for a caller entitled to spend it.
   *
   * Undefined where there is none, which falls through to the usual "send your
   * own key". Refused outright where there is one and the caller is not ours:
   * the quota behind it is finite and somebody pays for it, so an unrecognised
   * caller is turned away rather than quietly served and billed to us.
   */
  private managed(
    provider: WeatherProvider,
    payload: WeatherPayload,
  ): string | undefined {
    const credential = provider.credential?.();
    if (!credential) return undefined;

    if (!this.clients.allows(payload.clientKey)) {
      throw new UnauthorizedException(
        `This service holds its own ${provider.info.name} credential. Send a ` +
          'client key it recognises in the X-Weather-Client-Key header, or ' +
          `your own ${provider.info.name} key in X-Weather-Api-Key ` +
          `(${provider.info.apiKeyUrl}).`,
      );
    }
    return credential;
  }

  /**
   * The warnings the provider issued with the reading, narrowed as asked.
   *
   * The region atlas has no part to play — the provider scoped them itself —
   * so how wide they were cast is the provider's claim to make, not ours.
   * `safety` and `area` still apply, because a floor a caller set should mean
   * the same thing whichever source answered.
   */
  private issued(
    reading: ProviderReading,
    payload: WeatherPayload,
  ): Warnings | undefined {
    if (!reading.alerts) return undefined;
    return {
      alerts: filterAlerts(reading.alerts, {
        safety: payload.safety,
        area: payload.area,
      }),
      // Assumed national where a provider does not say, which is the reading
      // that under-promises: telling a caller their list is narrowed when it
      // is not is the one thing `AlertScope` exists to prevent.
      scope: reading.alertScope ?? 'country',
    };
  }

  /**
   * The warnings in force, or nothing at all.
   *
   * Swallowed like the UV index and for the same reason, with one more way of
   * coming back empty-handed: MeteoAlarm covers Europe, and a cell outside it
   * has no feed to ask rather than a feed that answers nothing.
   */
  private alerts(
    payload: WeatherPayload,
    country: string,
    language: string,
    cell: Cell,
  ): Promise<Warnings | undefined> | undefined {
    if (!payload.includeAlerts || !this.alertProvider.covers(country)) {
      return undefined;
    }

    return this.alertProvider
      .read(country, language)
      .then((alerts) => {
        if (alerts === undefined) return undefined;

        // Placed only once the feed has answered. The atlas is two megabytes
        // read and parsed on first use, and doing that before the request goes
        // out would block the event loop — this one's own upstream call
        // included — for the fifteen milliseconds it takes.
        const covering = this.atlas.covering(
          country,
          cell.latitude,
          cell.longitude,
        );

        // Narrowing needs two things to be true: the cell landed in a region,
        // and this feed scopes its warnings by codes the atlas can place. The
        // second is read off the scheme each code declares rather than guessed
        // from the code itself — France publishes NUTS3, four of which are
        // spelled exactly like EMMA regions, so a match on the string alone
        // narrows Bordeaux to nothing and calls it an answer.
        const placeable = alerts.flatMap(emmaCodes);
        const scoped =
          covering.length > 0 && this.atlas.speaks(country, placeable);

        return {
          alerts: filterAlerts(alerts, {
            safety: payload.safety,
            area: payload.area,
            regions: scoped ? covering : [],
          }),
          scope: (scoped ? 'area' : 'country') as AlertScope,
        };
      })
      .catch(() => undefined);
  }

  /**
   * The safety floor, checked before anything is fetched.
   *
   * Refused rather than ignored: a caller who misspells the band they care
   * about should be told, not quietly handed every warning in the country as
   * though they had asked for none.
   */
  private safety(safety?: string): void {
    if (safety && !SAFETY_BANDS.includes(plain(safety))) {
      throw new BadRequestException(
        `Unknown safety band '${safety}'. Supported: ${SAFETY_BANDS.join(', ')}`,
      );
    }
  }

  /**
   * The country the caller named, checked before anything is fetched.
   *
   * Refused rather than ignored for the same reason `safety` is: a caller who
   * sends a country name where a code belongs would otherwise be handed a
   * reading with no warnings at all and no hint as to why.
   */
  private country(country?: string): string | undefined {
    if (country === undefined) return undefined;
    const code = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new BadRequestException(
        `Country must be an ISO alpha-2 code, not '${country}'`,
      );
    }
    return code;
  }

  private pick(id?: string): WeatherProvider {
    const provider = this.providers.get((id ?? DEFAULT_PROVIDER).toLowerCase());
    if (!provider) {
      throw new BadRequestException(
        `Unknown weather provider '${id}'. Supported: ${[...this.providers.keys()].join(', ')}`,
      );
    }
    return provider;
  }

  /**
   * The cell the reading is for.
   *
   * Coordinates are rounded here and nowhere else, and the rounded pair is both
   * what the provider is asked about and what comes back in `location` — so the
   * cache key, the upstream question and the answer's own account of itself
   * cannot drift apart.
   */
  private async locate(
    provider: WeatherProvider,
    payload: WeatherPayload,
    apiKey: string,
    language: string,
    country?: string,
  ): Promise<Cell> {
    const { latitude, longitude } = payload;
    if (latitude !== undefined && longitude !== undefined) {
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        throw new BadRequestException(
          'Latitude must be within ±90 and longitude within ±180',
        );
      }
      return {
        latitude: roundCoordinate(latitude),
        longitude: roundCoordinate(longitude),
        // A coordinate does not carry a country, and the warnings are scoped by
        // one. The caller's own is taken at face value here — it is not
        // `geocoded`, so it never overwrites what the reading says the place is
        // called; it only decides which national feed is worth asking, and
        // which country WeatherKit scopes its own warnings to.
        //
        // Where they sent none, the atlas is asked. It holds the outlines of
        // every warning region in the thirty-five countries MeteoAlarm covers,
        // which is a map of those countries by another name, and it is already
        // in memory to narrow warnings to a valley. Without this a caller who
        // sends coordinates and no country gets no warnings at all from a
        // provider that does not geocode: Apple names no country, so nothing
        // was ever sent to WeatherKit and nothing was ever asked of MeteoAlarm,
        // and both silences looked exactly like fair weather.
        country: country ?? this.atlas.locate(latitude, longitude),
        geocoded: false,
      };
    }

    const query = payload.location?.trim();
    if (!query) {
      throw new BadRequestException(
        'Ask about a place: either `location`, or both `lat` and `lon`',
      );
    }
    // A provider that geocodes answers for itself, so the place it names and
    // the reading it gives come from one source. One that does not — Apple
    // answers the weather at a point and nothing else — is not a reason to
    // refuse the question, only a reason to ask someone else where the place
    // is. Which of the two answered is what `borrowed` records, so the credit
    // can follow.
    const place = provider.info.geocoding
      ? await provider.locate(query, apiKey, language)
      : await this.geocoder.locate(query, language);
    if (!place) {
      throw new NotFoundException(`No place matching '${query}'`);
    }
    return {
      latitude: roundCoordinate(place.latitude),
      longitude: roundCoordinate(place.longitude),
      name: place.name,
      country: place.country,
      geocoded: true,
      borrowed: !provider.info.geocoding,
    };
  }

  /**
   * The language tag as the providers spell it: lowercase, and underscored
   * where a region is named (`pt_br`, `zh_cn`). Anything else is dropped rather
   * than passed on, because an unknown tag is answered in English anyway and a
   * stray one would fragment the cache into a cell per spelling.
   */
  private language(language?: string): string {
    const tag = (language ?? 'en').toLowerCase().replace(/-/g, '_');
    return /^[a-z]{2}(_[a-z]{2})?$/.test(tag) ? tag : 'en';
  }

  private units(units?: WeatherUnits): WeatherUnits {
    if (!units) return 'metric';
    if (!UNITS.includes(units)) {
      throw new BadRequestException(
        `Unknown units '${units}'. Supported: ${UNITS.join(', ')}`,
      );
    }
    return units;
  }
}
