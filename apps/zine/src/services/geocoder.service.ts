import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { fetchWithTimeout } from '@canopus/nest';

const API_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

type GeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: {
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }[];
};

/** What a venue's whereabouts turn out to be, once somebody has been asked. */
export type GeocodedVenue = {
  /** `[longitude, latitude]` as strings, which is the shape a cinema carries. */
  coordinates: string[];
  /** The address as the geocoder writes it, for a venue that had none. */
  address?: string;
};

/**
 * Where a cinema is, for the venues whose listing never said.
 *
 * The sites these are scraped from print an address when they feel like it and
 * a coordinate never, so a venue arrives as a name and a city — which is enough
 * to put a billboard on screen and not enough to put a pin on a map. Asked once
 * per venue, at update time, and written to the database: a coordinate does not
 * change, and geocoding the same forty cinemas on every request would be a bill
 * for an answer we already had.
 *
 * Only what is missing is asked about. A venue that already has coordinates is
 * skipped entirely, so the second update costs nothing and the tenth costs
 * nothing.
 *
 * No key configured, nothing is asked and every venue keeps what it has. This
 * is an enrichment: a deployment without a Google key should still serve
 * billboards, which is what it was doing before any of this existed.
 */
@Injectable()
export class GeocoderService {
  private readonly logger = new Logger(GeocoderService.name);
  /** Said once per process rather than once per venue. */
  private warned = false;

  constructor(private httpService: HttpService) {}

  get configured(): boolean {
    return Boolean(process.env.GOOGLE_MAPS_API_KEY);
  }

  /**
   * The venue's whereabouts, or nothing.
   *
   * Nothing is the common failure and not an error: a cinema that has closed,
   * a name a map has never heard of, or a query too vague to place. The caller
   * leaves the record as it found it.
   */
  async locate(
    name: string,
    address?: string,
    location?: string,
  ): Promise<GeocodedVenue | undefined> {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'GOOGLE_MAPS_API_KEY is unset: cinema coordinates will not be filled in',
        );
      }
      return undefined;
    }

    // The name as well as the address, because the address is what is missing
    // half the time. "Cines Palafox, Zaragoza, ES" is a query a map can answer;
    // an empty address is not.
    const query = [name, address, location, 'España']
      .filter(Boolean)
      .join(', ');
    const params = new URLSearchParams({
      address: query,
      region: 'es',
      language: 'es',
      key,
    });

    try {
      const body = await fetchWithTimeout<GeocodeResponse>(
        this.httpService,
        `${API_URL}?${params}`,
      );
      // ZERO_RESULTS is an answer; the rest are worth reading in a log, since
      // a rejected key looks exactly like a venue nobody can place.
      if (body?.status !== 'OK' || !body.results?.length) {
        if (body?.status && body.status !== 'ZERO_RESULTS') {
          this.logger.warn(
            `geocoding '${query}' answered ${body.status}${
              body.error_message ? `: ${body.error_message}` : ''
            }`,
          );
        }
        return undefined;
      }

      const [best] = body.results;
      const point = best.geometry?.location;
      if (typeof point?.lat !== 'number' || typeof point?.lng !== 'number') {
        return undefined;
      }

      return {
        // Longitude first: that is the order a cinema's `coordinates` have
        // always been in, and the clients reading them index rather than name.
        coordinates: [String(point.lng), String(point.lat)],
        ...(best.formatted_address ? { address: best.formatted_address } : {}),
      };
    } catch (exception) {
      this.logger.error(`failed to geocode '${query}': ${exception.message}`);
      return undefined;
    }
  }
}
