import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Attribution,
  ProviderInfo,
  WeatherPayload,
  WeatherResponse,
  WeatherUnits,
} from '../models/weather.interface';
import { OpenMeteoUvProvider } from '../providers/open-meteo-uv.provider';
import { WEATHER_PROVIDERS } from '../providers/registry';
import { WeatherProvider } from '../providers/weather-provider';
import { roundCoordinate } from '../utils';

const DEFAULT_PROVIDER = 'openweather';
const UNITS: WeatherUnits[] = ['metric', 'imperial', 'standard'];

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
    const cell = await this.locate(provider, payload, apiKey, language);

    const [reading, uv] = await Promise.all([
      provider.read({
        apiKey,
        latitude: cell.latitude,
        longitude: cell.longitude,
        language,
        units,
      }),
      // Swallowed rather than awaited with the rest: the sun is one field from
      // a second service, and that service being down should cost the field
      // rather than the temperature.
      payload.includeUv
        ? this.uvProvider
            .read(cell.latitude, cell.longitude)
            .catch(() => undefined)
        : undefined,
    ]);

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
      attribution,
      lastUpdated: new Date(reading.current.observedAt * 1000).toISOString(),
    };
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
