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
  ProviderInfo,
  WeatherAlert,
  WeatherPayload,
  WeatherResponse,
  WeatherUnits,
} from '../models/weather.interface';
import {
  emmaCodes,
  MeteoAlarmProvider,
  SAFETY_BANDS,
} from '../providers/meteoalarm.provider';
import { RegionAtlas } from '../providers/region-atlas';
import { OpenMeteoUvProvider } from '../providers/open-meteo-uv.provider';
import { WEATHER_PROVIDERS } from '../providers/registry';
import { WeatherProvider } from '../providers/weather-provider';
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
}

@Injectable()
export class WeatherService {
  constructor(
    @Inject(WEATHER_PROVIDERS)
    private readonly providers: Map<string, WeatherProvider>,
    private readonly uvProvider: OpenMeteoUvProvider,
    private readonly alertProvider: MeteoAlarmProvider,
    private readonly atlas: RegionAtlas,
  ) {}

  listProviders(): ProviderInfo[] {
    return [...this.providers.values()].map((provider) => provider.info);
  }

  async getWeather(payload: WeatherPayload): Promise<WeatherResponse> {
    const provider = this.pick(payload.provider);
    const apiKey = payload.apiKey?.trim();
    if (!apiKey) {
      throw new UnauthorizedException(
        `Send your own ${provider.info.name} key in the X-Weather-Api-Key header (${provider.info.apiKeyUrl})`,
      );
    }

    const language = this.language(payload.language);
    const units = this.units(payload.units);
    this.safety(payload.safety);
    const cell = await this.locate(provider, payload, apiKey, language);

    const [reading, uv, geocodedAlerts] = await Promise.all([
      provider.read({
        apiKey,
        latitude: cell.latitude,
        longitude: cell.longitude,
        language,
        units,
        // The one flag that defaults on: the day's high and low are read off
        // the forecast, so a caller who says nothing keeps the answer they
        // have always had.
        includeForecast: payload.includeForecast ?? true,
      }),
      // Swallowed rather than awaited with the rest: the sun is one field from
      // a second service, and that service being down should cost the field
      // rather than the temperature.
      payload.includeUv
        ? this.uvProvider
            .read(cell.latitude, cell.longitude)
            .catch(() => undefined)
        : undefined,
      // Warnings are national, so the country picks the feed — and the country
      // is known this early only when a name was geocoded. Asked alongside the
      // reading when it is, and off the reading itself when it is not.
      cell.country
        ? this.alerts(payload, cell.country, language, cell)
        : undefined,
    ]);

    const warnings = cell.country
      ? geocodedAlerts
      : await this.alerts(payload, reading.location.country, language, cell);

    const provides = [
      ...reading.provides,
      ...(cell.geocoded ? ['geocoding'] : []),
    ];
    const attribution: Attribution[] = [
      { name: provider.info.name, url: provider.info.url, provides },
    ];
    if (uv) {
      attribution.push({
        name: this.uvProvider.name,
        url: this.uvProvider.url,
        provides: ['uv'],
      });
    }
    // Credited for an empty list too, unlike the fields above. "No warnings are
    // in force here" is a claim, and it is MeteoAlarm's rather than ours; the
    // case where nothing is owed is the feed not answering at all, and that
    // leaves `alerts` off the response entirely.
    if (warnings) {
      attribution.push({
        name: this.alertProvider.name,
        url: this.alertProvider.url,
        provides: ['alerts'],
      });
    }

    return {
      provider: provider.info.id,
      units,
      location: {
        ...reading.location,
        // The name the caller asked about beats the one the provider's nearest
        // station answers with: the cell is eleven kilometres wide, and on its
        // edge that station belongs to the next village along.
        ...(cell.geocoded ? { name: cell.name, country: cell.country } : {}),
      },
      current: { ...reading.current, ...(uv ?? {}) },
      forecast: reading.forecast,
      ...(warnings
        ? { alerts: warnings.alerts, alertScope: warnings.scope }
        : {}),
      attribution,
      lastUpdated: new Date(reading.current.observedAt * 1000).toISOString(),
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

    const covering = this.atlas.covering(
      country,
      cell.latitude,
      cell.longitude,
    );

    return this.alertProvider
      .read(country, language)
      .then((alerts) => {
        if (alerts === undefined) return undefined;

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
          alerts: this.alertProvider.filter(alerts, {
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
    if (safety && !SAFETY_BANDS.includes(safety.trim().toLowerCase())) {
      throw new BadRequestException(
        `Unknown safety band '${safety}'. Supported: ${SAFETY_BANDS.join(', ')}`,
      );
    }
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
        geocoded: false,
      };
    }

    const query = payload.location?.trim();
    if (!query) {
      throw new BadRequestException(
        'Ask about a place: either `location`, or both `lat` and `lon`',
      );
    }
    if (!provider.info.geocoding) {
      throw new BadRequestException(
        `${provider.info.name} does not resolve place names; send \`lat\` and \`lon\``,
      );
    }

    const place = await provider.locate(query, apiKey, language);
    if (!place) {
      throw new NotFoundException(`No place matching '${query}'`);
    }
    return {
      latitude: roundCoordinate(place.latitude),
      longitude: roundCoordinate(place.longitude),
      name: place.name,
      country: place.country,
      geocoded: true,
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
