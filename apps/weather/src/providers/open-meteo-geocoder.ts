import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { TTL } from '../utils';
import { upstreamGet } from './upstream';
import { GeocodedPlace } from './weather-provider';

const API_URL = 'https://geocoding-api.open-meteo.com/v1/search';

type SearchResponse = {
  results?: {
    name?: string;
    latitude?: number;
    longitude?: number;
    country_code?: string;
    admin1?: string;
  }[];
};

/**
 * Where a place name becomes a coordinate, for the providers that cannot.
 *
 * Most providers geocode as a side line of business and this is never used.
 * Apple does not: WeatherKit answers the weather at a point and nothing else,
 * in either direction. Without this, asking it about "Zaragoza" is refused and
 * every caller has to carry a geocoder of their own — which is a strange thing
 * for an endpoint whose whole job is to take the awkward parts off them.
 *
 * Open-Meteo again, and for the same reason it answers the UV index here: it
 * needs no key of any kind, so a caller who brought one provider's credential
 * is not asked for a second. It is credited in `attribution` like every other
 * source, under `geocoding`.
 */
@Injectable()
export class OpenMeteoGeocoder {
  readonly name = 'Open-Meteo';
  readonly url = 'https://open-meteo.com/';
  /** Open-Meteo publishes under CC BY 4.0, which asks for the credit back. */
  readonly licence = 'https://creativecommons.org/licenses/by/4.0/';
  /**
   * The words the licence asks for, which are these words: Open-Meteo's terms
   * ask for a link "next to any location Open-Meteo data are displayed", and
   * name this line as the form it should take.
   */
  readonly notice = 'Weather data by Open-Meteo.com';

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  /**
   * The first place of that name, or nothing.
   *
   * Cached for as long as a provider's own geocoding is: place names do not
   * move, and the bound is on how far a caller looping over invented names can
   * grow the map rather than on how long the answer stays true.
   */
  async locate(
    query: string,
    language: string,
  ): Promise<GeocodedPlace | undefined> {
    const params = new URLSearchParams({
      name: query,
      count: '1',
      format: 'json',
      // Open-Meteo takes a bare two-letter tag, not the region-qualified form
      // the providers are asked in; `pt_br` comes back as no results at all.
      language: language.slice(0, 2),
    });

    const body = await this.cacheManager.wrap(
      `openmeteo/geocode/${language.slice(0, 2)}/${query.toLowerCase()}`,
      () =>
        upstreamGet<SearchResponse>(
          this.httpService,
          `${API_URL}?${params}`,
          this.name,
        ),
      TTL.geocode,
    );

    const place = body?.results?.[0];
    if (
      !place ||
      typeof place.latitude !== 'number' ||
      typeof place.longitude !== 'number'
    ) {
      return undefined;
    }

    return {
      name: place.name ?? query,
      country: place.country_code ?? '',
      latitude: place.latitude,
      longitude: place.longitude,
    };
  }
}
