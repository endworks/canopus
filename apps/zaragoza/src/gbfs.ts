import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { fetchWithTimeout } from '@canopus/nest';

/**
 * The bike share's own feed, in the shape every bike share publishes it.
 *
 * GBFS is the standard the operators publish to — two documents behind one
 * discovery URL: `station_information` says where a rack is and how big it is
 * and changes about never, `station_status` says how many bikes are on it and
 * changes every few seconds. That split is the one this service already has,
 * which is why the operator's feed drops into it: the stored station is the
 * information half, and the live read is the status half.
 *
 * Nothing here names a provider. A feed is reached from its discovery document
 * and the document says where its own feeds are, so moving between operators —
 * or between an operator's own URL layouts — is a change of one environment
 * variable rather than a change of code.
 */

/** What `station_information` carries, of what this service reads. */
export interface GbfsStationInfo {
  station_id: string;
  /**
   * GBFS 3 writes this as a list of localised strings where every version
   * before it wrote one. Nothing here reads it — the street this service
   * serves is the city's, so that the two roads name a station alike — but it
   * is typed as both so that nobody reads it as a string and is right only
   * until the feed's version moves.
   */
  name?: string | { text?: string; language?: string }[];
  lat?: number;
  lon?: number;
  capacity?: number;
}

/** What `station_status` carries, of what this service reads. */
export interface GbfsStationStatus {
  station_id: string;
  num_bikes_available?: number;
  num_docks_available?: number;
  is_installed?: boolean | number;
  is_renting?: boolean | number;
  is_returning?: boolean | number;
  /** GBFS 2.1 and later: the count broken down by kind of vehicle. */
  vehicle_types_available?: { vehicle_type_id: string; count: number }[];
  /** GBFS 2.0: the same thing, keyed by vehicle type id. */
  num_bikes_available_types?: Record<string, number>;
}

/**
 * A station's state, said the same way whichever road answered.
 *
 * The city writes this in Spanish and the operator writes it as three booleans,
 * and a reader hitting the same endpoint twice during a handover must not be
 * told two different things about the same rack. So both roads are normalised
 * here, and this is the vocabulary the endpoint promises.
 *
 * `NOT_RENTING` and `NOT_RETURNING` are worth keeping apart: a rack that is
 * full takes no bikes back but will still hand you one, and telling somebody
 * riding towards it that it is simply closed sends them to the wrong rack.
 */
export const STATION_STATES = [
  'IN_SERVICE',
  'NOT_RENTING',
  'NOT_RETURNING',
  'CLOSED',
] as const;

export type StationState = (typeof STATION_STATES)[number];

/** GBFS writes these as booleans; some feeds still write them as 0 and 1. */
const flag = (value: boolean | number | undefined, fallback: boolean) =>
  value === undefined || value === null ? fallback : !!value;

/** The operator's three booleans, as the one word this endpoint promises. */
export const gbfsState = (status: GbfsStationStatus): StationState => {
  if (!flag(status.is_installed, true)) return 'CLOSED';
  const renting = flag(status.is_renting, true);
  const returning = flag(status.is_returning, true);
  if (!renting && !returning) return 'CLOSED';
  if (!renting) return 'NOT_RENTING';
  if (!returning) return 'NOT_RETURNING';
  return 'IN_SERVICE';
};

/**
 * What the city writes in the `estado` field, in the same words.
 *
 * The city's vocabulary is not published anywhere, so this maps what it is
 * known to say and hands back anything else unchanged rather than inventing a
 * state for it. An unrecognised value is logged once, which is how the rest of
 * the vocabulary turns up — quietly folding it into `CLOSED` would be a guess
 * that reads as a fact.
 */
const cityStates = new Map<string, StationState>([
  ['abierta', 'IN_SERVICE'],
  ['activa', 'IN_SERVICE'],
  ['operativa', 'IN_SERVICE'],
  ['en servicio', 'IN_SERVICE'],
  ['cerrada', 'CLOSED'],
  ['inactiva', 'CLOSED'],
  ['averiada', 'CLOSED'],
  ['fuera de servicio', 'CLOSED'],
]);

const unknownStates = new Set<string>();
const stateLogger = new Logger('BiziState');

export const cityState = (raw?: string | null): string | null => {
  if (!raw) return null;
  const known = cityStates.get(raw.trim().toLowerCase());
  if (known) return known;
  if (!unknownStates.has(raw)) {
    unknownStates.add(raw);
    stateLogger.warn(
      `The city reported a station state this does not know how to say: ${raw}`,
    );
  }
  return raw;
};

/**
 * The bikes on a rack that are electric.
 *
 * The whole point of asking the operator rather than the city: `bikes` is one
 * number and cannot say that six of the seven need pedalling. Which type id
 * means electric is the feed's to declare, so this counts the types that
 * declare themselves electric and returns nothing at all where the feed does
 * not break the count down — nothing is what we know, and nought is a claim.
 */
const electricTypes = /electric|ebike|e-bike|pedelec/i;

export const electricBikes = (
  status: GbfsStationStatus,
): number | undefined => {
  if (status.vehicle_types_available?.length) {
    const electric = status.vehicle_types_available.filter((type) =>
      electricTypes.test(type.vehicle_type_id),
    );
    if (!electric.length) return undefined;
    return electric.reduce((total, type) => total + (type.count ?? 0), 0);
  }

  const byType = status.num_bikes_available_types;
  if (byType) {
    const ids = Object.keys(byType).filter((id) => electricTypes.test(id));
    if (!ids.length) return undefined;
    return ids.reduce((total, id) => total + (byType[id] ?? 0), 0);
  }

  return undefined;
};

/**
 * Metres between two points, near enough over a city.
 *
 * Equirectangular rather than haversine: over the couple of hundred metres
 * that decide whether two records are the same rack, the two agree to well
 * under the error in the coordinates themselves.
 */
const metresApart = (
  [lonA, latA]: [number, number],
  [lonB, latB]: [number, number],
): number => {
  const mean = ((latA + latB) / 2) * (Math.PI / 180);
  const x = (lonA - lonB) * (Math.PI / 180) * Math.cos(mean);
  const y = (latA - latB) * (Math.PI / 180);
  return Math.hypot(x, y) * 6371000;
};

/**
 * How far apart two records of the same rack are allowed to be. Wide enough
 * for the city and the operator having surveyed the same rack from opposite
 * kerbs, narrow enough that the two racks either end of a plaza stay two.
 */
const SAME_RACK_METRES = 40;

const point = (coordinates: string[]): [number, number] | null => {
  const [lon, lat] = (coordinates ?? []).map(Number);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
};

/**
 * Which operator station is which city station, by where they stand.
 *
 * The two sources number their stations independently, and nothing published
 * joins them up — so the join is the rack itself. Every candidate pair inside
 * the tolerance is sorted by distance and taken nearest first, each station
 * spent once, which is what stops two racks at the same junction from both
 * claiming the nearer of the operator's two.
 *
 * A city station with no match keeps no operator id and is simply asked about
 * on the city's road, which is the same place it was before any of this.
 */
export const pairByPosition = (
  cityStations: { id: string; coordinates: string[] }[],
  operatorStations: GbfsStationInfo[],
): Map<string, string> => {
  const candidates: { city: string; operator: string; metres: number }[] = [];

  cityStations.forEach((station) => {
    const here = point(station.coordinates);
    if (!here) return;
    operatorStations.forEach((operator) => {
      if (
        typeof operator.lat !== 'number' ||
        typeof operator.lon !== 'number'
      ) {
        return;
      }
      const metres = metresApart(here, [operator.lon, operator.lat]);
      if (metres <= SAME_RACK_METRES) {
        candidates.push({
          city: station.id,
          operator: operator.station_id,
          metres,
        });
      }
    });
  });

  candidates.sort((a, b) => a.metres - b.metres);

  const paired = new Map<string, string>();
  const spent = new Set<string>();
  candidates.forEach(({ city, operator }) => {
    if (paired.has(city) || spent.has(operator)) return;
    paired.set(city, operator);
    spent.add(operator);
  });

  return paired;
};

/** A discovery document, in either of the two shapes the versions gave it. */
interface GbfsDiscovery {
  data?:
    | { feeds?: { name: string; url: string }[] }
    | Record<string, { feeds?: { name: string; url: string }[] }>;
}

/**
 * The operator's feed, or nothing where this deployment has not been given one.
 *
 * Every read is the caller's to fail: this is the first of three roads to a
 * station, and a road that cannot answer says so by throwing rather than by
 * handing back an empty feed that reads as a city with no bikes in it.
 */
export class GbfsClient {
  private readonly logger = new Logger(GbfsClient.name);
  /** The discovery document is read once a process, not once a request. */
  private feeds?: Promise<Map<string, string>>;

  constructor(
    private readonly http: HttpService,
    private readonly discoveryUrl?: string,
  ) {}

  get enabled(): boolean {
    return !!this.discoveryUrl;
  }

  async stationInformation(): Promise<GbfsStationInfo[]> {
    return this.stations<GbfsStationInfo>('station_information');
  }

  async stationStatus(): Promise<GbfsStationStatus[]> {
    return this.stations<GbfsStationStatus>('station_status');
  }

  private async stations<T>(feed: string): Promise<T[]> {
    const url = (await this.feedUrls()).get(feed);
    if (!url) throw new Error(`The operator's feed publishes no ${feed}`);
    const document = await fetchWithTimeout<{ data?: { stations?: T[] } }>(
      this.http,
      url,
    );
    return document?.data?.stations ?? [];
  }

  /**
   * Where each feed lives, as the discovery document says.
   *
   * Read once and remembered: these URLs are a property of the deployment, not
   * of the request, and asking for them on every station lookup would double
   * the traffic to buy nothing. A read that fails is not remembered, so the
   * next request tries again rather than the process staying broken.
   */
  private async feedUrls(): Promise<Map<string, string>> {
    if (!this.discoveryUrl) throw new Error('No operator feed is configured');
    if (!this.feeds) {
      this.feeds = this.readDiscovery(this.discoveryUrl).catch((exception) => {
        this.feeds = undefined;
        throw exception;
      });
    }
    return this.feeds;
  }

  private async readDiscovery(url: string): Promise<Map<string, string>> {
    const document = await fetchWithTimeout<GbfsDiscovery>(this.http, url);
    const data = document?.data ?? {};

    // GBFS 3 puts the feeds straight under `data`; every version before it
    // keyed them by language first, and a system serving one language is the
    // usual case either way — so the first set of feeds found is the set.
    const direct = (data as { feeds?: { name: string; url: string }[] }).feeds;
    const feeds =
      direct ??
      Object.values(data as Record<string, { feeds?: unknown }>).flatMap(
        (language) =>
          (language?.feeds as { name: string; url: string }[]) ?? [],
      );

    const urls = new Map(feeds.map((feed) => [feed.name, feed.url]));
    this.logger.log(
      `Read the operator's feed listing: ${[...urls.keys()].join(', ') || 'nothing'}`,
    );
    return urls;
  }
}

/**
 * Where Bizi's operator publishes its feed.
 *
 * Bizi runs on PBSC's platform — the `publicbikesystem.net` that Bilbao and
 * Donostia are on too — which Lyft bought in 2022, and which is why the app the
 * city points riders at is a Lyft app. This URL is the one the system itself
 * registers in MobilityData's GBFS catalogue: published, unauthenticated, and
 * meant to be read. So it is written down here beside every other source this
 * service reads rather than configured into a deployment, and nothing had to be
 * pulled out of the app to find it.
 */
const zaragozaGbfsURL =
  'https://zaragoza.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json';

/** What turns the road off, for the deployment that needs it off in a hurry. */
const disabled = /^(off|none|false|0)$/i;

/**
 * The feed this deployment reads.
 *
 * The registered URL by default, because it is a fact about Bizi rather than
 * about a deployment. `BIZI_GBFS_URL` still overrides it — for a system that
 * moves, or a mirror — and setting it to `off` takes the operator road out
 * altogether, which is a repository variable rather than a revert on the day
 * the feed misbehaves.
 */
export const biziGbfs = (
  http: HttpService,
  env: NodeJS.ProcessEnv = process.env,
): GbfsClient => {
  const configured = (env.BIZI_GBFS_URL ?? '').trim();
  if (disabled.test(configured)) return new GbfsClient(http, undefined);
  return new GbfsClient(http, configured || zaragozaGbfsURL);
};
