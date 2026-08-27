import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { TTL, UV_PROTECTION } from '../utils';
import { upstreamGet } from './upstream';

const API_URL = 'https://api.open-meteo.com/v1/forecast';

type UvResponse = {
  current?: { uv_index?: number };
  hourly?: { time?: number[]; uv_index?: number[] };
};

export interface UvReading {
  uv: number;
  uvProtectionUntil?: number;
}

/**
 * Where the sun's part of this comes from, which is not the weather provider.
 *
 * OpenWeather's free plan carries no UV index at all — it moved to One Call
 * 3.0, a separate subscription behind a card — and Open-Meteo answers it
 * without a key of any kind. That is a second service in an endpoint that
 * otherwise has one, which is the whole reason the response credits its sources
 * in an array and the whole reason the row is opt-in: a caller who does not
 * want a second party in the request simply does not send the header.
 */
@Injectable()
export class OpenMeteoUvProvider {
  readonly name = 'Open-Meteo';
  readonly url = 'https://open-meteo.com/';

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  /**
   * The index now, and when it stops being worth protecting against.
   *
   * Unix seconds rather than the service's own local ISO strings: it will
   * answer either, and `timezone=auto` means those strings carry no offset, so
   * a client whose clock is not the place's would read a naive local hour as
   * its own. The wire should carry an instant.
   */
  async read(
    latitude: number,
    longitude: number,
  ): Promise<UvReading | undefined> {
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'uv_index',
      hourly: 'uv_index',
      forecast_days: '1',
      timeformat: 'unixtime',
      timezone: 'auto',
    });

    const body = await this.cacheManager.wrap(
      `openmeteo/uv/${latitude},${longitude}`,
      () =>
        upstreamGet<UvResponse>(
          this.httpService,
          `${API_URL}?${query}`,
          this.name,
        ),
      TTL.uv,
    );

    const uv = body?.current?.uv_index;
    // Nought is a reading — it is night — so this asks what the value is rather
    // than whether it is truthy.
    if (typeof uv !== 'number') return undefined;
    if (uv < UV_PROTECTION) return { uv };

    // The first hour ahead that is back under the threshold, not the last one
    // over it. The sun comes down once a day, so on this one-day window the two
    // are the same answer; on a longer one, the last hour over the line is
    // tomorrow lunchtime, which is not what "until" means.
    const times = body.hourly?.time ?? [];
    const values = body.hourly?.uv_index ?? [];
    const now = Date.now() / 1000;
    const until = times.find(
      (time, index) => time > now && (values[index] ?? 0) < UV_PROTECTION,
    );

    return { uv, ...(until ? { uvProtectionUntil: until } : {}) };
  }
}
