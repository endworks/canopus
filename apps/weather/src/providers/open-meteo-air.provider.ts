import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { TTL } from '../utils';
import { AirSource } from './air-source';
import { europeanAqi } from './european-aqi';
import { upstreamGet } from './upstream';

const API_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** Open-Meteo's names for the five the European index is graded on. */
const POLLUTANTS = [
  'pm2_5',
  'pm10',
  'nitrogen_dioxide',
  'ozone',
  'sulphur_dioxide',
] as const;

type AirResponse = {
  current?: Partial<Record<(typeof POLLUTANTS)[number], number>>;
};

/**
 * The air, for a provider that does not carry it.
 *
 * The same arrangement as the UV index and for the same reason: WeatherKit
 * answers no pollutant of any kind, and Open-Meteo answers all five without a
 * key. So a caller asking Apple for the weather still gets a graded air rather
 * than a field that silently only exists for one provider.
 *
 * It returns concentrations, not a grade. Open-Meteo publishes a European index
 * of its own and this deliberately ignores it: the point of computing the index
 * in one place is that OpenWeather's air and Apple's air are graded by the same
 * table, and taking a ready-made number from one of them would put that back to
 * two scales wearing one name.
 *
 * It is also the source of last resort — the one that covers everywhere, so
 * that a city's own network can be tried first and cost nothing when it has
 * nothing to say. See `AirSources`.
 */
@Injectable()
export class OpenMeteoAirProvider extends AirSource {
  readonly name = 'Open-Meteo';
  readonly url = 'https://open-meteo.com/';
  /** Open-Meteo publishes under CC BY 4.0, which asks for the credit back. */
  readonly licence = 'https://creativecommons.org/licenses/by/4.0/';
  readonly measured = false;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {
    super();
  }

  /**
   * Everywhere. It is a global model, so there is no cell it has no answer
   * for — which is what makes it the one every other source falls back to.
   */
  covers(): boolean {
    return true;
  }

  async read(latitude: number, longitude: number): Promise<number | undefined> {
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: POLLUTANTS.join(','),
    });

    const body = await this.cacheManager.wrap(
      `openmeteo/air/${latitude},${longitude}`,
      () =>
        upstreamGet<AirResponse>(
          this.httpService,
          `${API_URL}?${query}`,
          this.name,
        ),
      TTL.airQuality,
    );

    const current = body?.current;
    if (!current) return undefined;

    // Renamed on the way in, because the index's table is keyed by the short
    // names every other source uses and Open-Meteo spells three of them out.
    return europeanAqi({
      pm2_5: current.pm2_5,
      pm10: current.pm10,
      no2: current.nitrogen_dioxide,
      o3: current.ozone,
      so2: current.sulphur_dioxide,
    });
  }
}
