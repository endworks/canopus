import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { TTL } from '../utils';
import { upstreamGet } from './upstream';

const API_URL = 'https://nominatim.openstreetmap.org/reverse';

/**
 * Who is asking, which Nominatim's usage policy requires be said.
 *
 * It asks for an identifying User-Agent naming the application, so that an
 * operator with a problem has somebody to tell. A default axios agent is the
 * one thing the policy names as grounds for being blocked.
 */
const USER_AGENT =
  'canopus-weather/1.0 (https://github.com/endworks/canopus; hello@end.works)';

/**
 * The shortest gap between two calls, in milliseconds.
 *
 * Their policy caps this at one request a second, absolutely. Nothing here is
 * likely to reach it — a cell is answered once a week and only for a provider
 * that cannot name a place — but "unlikely" is not a rate limit, and a burst
 * of distinct coordinates would otherwise sail straight through it.
 */
const MIN_GAP_MS = 1000;

/**
 * How many callers may be waiting on that gap before the name is given up on.
 *
 * The gap above is a queue, and an unbounded queue is a way of turning
 * somebody else's rate limit into your own latency: the tenth caller in a
 * second would wait ten of them for one optional field, having already been
 * told the temperature. Past this many, the lookup is abandoned instead and
 * the place comes back unnamed — which is what it did before this file
 * existed, and is arrived at in milliseconds rather than in seconds.
 */
const MAX_QUEUED = 3;

/**
 * What the reverse endpoint answers, of which this reads very little.
 *
 * `address` rather than `display_name`: the latter is a full postal string
 * — "Zaragoza, Aragón, 50001, España" — and a `location.name` beside a
 * temperature wants the town on its own.
 */
type ReverseResponse = {
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country_code?: string;
  };
};

/** The place a coordinate stands in, named. */
export interface ReversedPlace {
  name: string;
  country: string;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Where a coordinate becomes a place name, for the providers that cannot.
 *
 * The mirror of `OpenMeteoGeocoder`, and it exists because that one cannot be
 * asked this question: Open-Meteo's geocoding API searches by name and offers
 * no reverse. So a caller who sent `lat`/`lon` to Apple — which does no
 * geocoding in either direction — used to get `name: ''` back, a reading about
 * a place the response could not name.
 *
 * OpenStreetMap answers it without a key, which is why it is here rather than
 * a provider's own reverse endpoint: a caller who brought one credential is
 * not asked for a second. It is credited in `attribution` under `geocoding`
 * like every other source, and its terms are the reason `notice` exists.
 *
 * Asked only where the question is real — a coordinate, and a provider that
 * will not name the place itself — so most requests never reach it at all.
 */
@Injectable()
export class OsmReverseGeocoder {
  readonly name = 'OpenStreetMap';
  readonly url = 'https://www.openstreetmap.org/';
  /** ODbL: the data may be reused, and the credit travels with it. */
  readonly licence = 'https://www.openstreetmap.org/copyright';
  /**
   * The words the licence asks for, which are these words. Not translated on
   * the way out, for the reason every `notice` is not: a licence names a
   * string, and "colaboradores de OpenStreetMap" credits nobody it has heard
   * of.
   */
  readonly notice = '© OpenStreetMap contributors';

  /** The tail of the queue below, when the last call went out, and its depth. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;
  private queued = 0;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  /**
   * The town this coordinate stands in, or nothing.
   *
   * Cached as long as a forward geocode is, and for the same reason: places do
   * not move, and what bounds the entry is how far a caller sweeping a
   * continent can grow the map rather than how long the answer stays true. The
   * coordinate is already rounded to its cell by the time it arrives, so
   * everyone in the same square kilometre shares one entry.
   *
   * Nothing is a perfectly good answer — the sea, a desert, an outage — and it
   * costs the name rather than the reading. See `WeatherService.getWeather`.
   */
  async reverse(
    latitude: number,
    longitude: number,
    language: string,
  ): Promise<ReversedPlace | undefined> {
    const tag = language.slice(0, 2);
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'jsonv2',
      // City level. Zoomed further in the answer is a street, and a street is
      // not what belongs beside a temperature; further out it is a region.
      zoom: '10',
      addressdetails: '1',
      'accept-language': tag,
    });

    const body = await this.cacheManager.wrap(
      `osm/reverse/${tag}/${latitude},${longitude}`,
      () =>
        this.spaced(() =>
          upstreamGet<ReverseResponse>(
            this.httpService,
            `${API_URL}?${params}`,
            this.name,
            { headers: { 'User-Agent': USER_AGENT } },
          ),
        ),
      TTL.geocode,
    );

    const address = body?.address;
    // In the order a person would answer the question, ending at the county
    // rather than the state: somewhere with no town within its cell is better
    // described by the district it sits in than by half a country.
    const name =
      address?.city ??
      address?.town ??
      address?.village ??
      address?.municipality ??
      address?.county ??
      body?.name;
    if (!name) return undefined;

    return { name, country: address?.country_code?.toUpperCase() ?? '' };
  }

  /**
   * One call at a time, never two inside a second, and never a long wait.
   *
   * Placed around the fetch rather than around `reverse` so a cache hit waits
   * for nobody: the policy is about what reaches Nominatim, and a hit reaches
   * nothing. A failed call still hands the queue on — otherwise one timeout
   * would leave every later caller waiting on a promise that never settles.
   *
   * Saturation throws rather than answering nothing, which is the part worth
   * pausing over: `wrap` stores what its factory returns, so an abandoned
   * lookup that came back empty would be cached as "this cell has no name" for
   * a week. Thrown, nothing is stored and the next caller asks again.
   */
  private spaced<T>(call: () => Promise<T>): Promise<T> {
    if (this.queued >= MAX_QUEUED) {
      return Promise.reject(
        new Error(
          `${this.name} is busy: ${this.queued} lookups already queued`,
        ),
      );
    }

    this.queued++;
    const next = this.queue.then(async () => {
      const wait = MIN_GAP_MS - (Date.now() - this.lastCall);
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      return call();
    });
    this.queue = next.catch(() => undefined).finally(() => this.queued--);
    return next;
  }
}
