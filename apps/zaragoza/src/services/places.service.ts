import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { ErrorResponse } from '@canopus/shared';
import { fetchWithTimeout } from '@canopus/nest';
import { Place, PlaceKind, PlacesResponse } from '../models/place.interface';
import { capitalizeEachWord } from '../utils';

const base = 'https://www.zaragoza.es/sede/servicio';
const equipment = `${base}/urbanismo-infraestructuras/equipamiento`;

/** The city hands out 500 rows at a time however many are asked for. */
const PAGE = 500;

/** A stop that has not moved since 2020 does not need asking about hourly. */
const STATIC_TTL = 1000 * 60 * 60 * 24;
/** A chemist on duty is on duty until midnight, and the list is a day old. */
const DAILY_TTL = 1000 * 60 * 60;
/** A taxi with its light on is somewhere else in a minute. */
const LIVE_TTL = 1000 * 30;

/** What the city's envelope looks like, whichever dataset it wraps. */
interface CityPlace {
  id: number | string;
  title?: string;
  description?: string;
  descripcion?: string;
  telefonos?: string;
  /** The street. Named for the field, which is what the city calls it. */
  calle?: string;
  /** The place's ordinary hours, where it publishes any. */
  horario?: string;
  url?: string;
  estado?: string;
  identificacion?: number;
  geometry?: { coordinates?: [number, number] };
  /** A chemist's duty shift: the day, the hours, and the sector it covers. */
  guardia?: {
    fecha?: string;
    horario?: string;
    sector?: string;
    turno?: string;
  };
}

interface CityResponse {
  totalCount?: number;
  result?: CityPlace[];
}

interface Dataset {
  /** Undefined for the sets this holds itself rather than fetches. */
  path?: string;
  ttl: number;
  /** Anything the shared mapping cannot know from the envelope alone. */
  extra?: (place: CityPlace) => Partial<Place>;
}

/**
 * The two cooperatives, which are not in any dataset.
 *
 * Zaragoza publishes where the ranks are and where the free taxis are, but a
 * taxi is ordered by telephone and no open dataset carries the number: a rank
 * record is an id, a street and a point. These two are about seventy per cent
 * of the fleet between them and the city's own taxi page names them, so they
 * are written here — the addresses from each cooperative's own legal notice,
 * the points geocoded from those addresses.
 *
 * Written down rather than fetched, and so the one thing here that can quietly
 * go stale. A number that changes is a store release, which is why the app
 * should prefer a remote-configured number over this when it has one.
 */
const offices: Place[] = [
  {
    id: 'radio-taxi-75',
    title: 'Radio Taxi 75',
    latitude: 41.6334301,
    longitude: -0.9235583,
    phone: '976757575',
    address: 'Avenida del Alcalde Gómez Laguna, 151',
    schedule: '24 h',
  },
  {
    id: 'radio-taxi-zaragoza',
    title: 'Radio Taxi Zaragoza',
    latitude: 41.6393417,
    longitude: -0.8711962,
    phone: '976424242',
    address: 'Avenida de Cesáreo Alierta, 83',
    schedule: '24 h',
  },
];

const datasets: Record<PlaceKind, Dataset> = {
  'taxi-rank': { path: `${equipment}/parada-taxi`, ttl: STATIC_TTL },
  'taxi-office': { ttl: STATIC_TTL },
  pharmacy: {
    path: `${base}/farmacia`,
    ttl: DAILY_TTL,
    extra: (place) => ({
      phone: place.telefonos?.replace(/\s+/g, '') || undefined,
      address: place.calle,
      // The shift, not the shop's own hours: this is the duty list, and at
      // eleven at night "Lunes a Domingo 24 horas" answers a question nobody
      // is asking. The ordinary hours are the fallback for a chemist the city
      // lists without one.
      schedule: place.guardia?.horario ?? place.horario,
      date: place.guardia?.fecha,
      detail: place.guardia?.sector,
      url: place.url?.trim() || undefined,
    }),
  },
};

export const placeKinds = Object.keys(datasets) as PlaceKind[];

@Injectable()
export class PlacesService {
  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  public async getPlaces(
    kind: PlaceKind,
  ): Promise<PlacesResponse | ErrorResponse> {
    const dataset = datasets[kind];
    if (!dataset) throw new NotFoundException(`Unknown place kind: ${kind}`);

    try {
      const cached: PlacesResponse = await this.cacheManager.get(
        `places/${kind}`,
      );
      if (cached) return cached;

      const places = dataset.path
        ? await this.fetchAll(dataset)
        : this.held(kind);

      const resp: PlacesResponse = {};
      places.forEach((place) => {
        resp[place.id] = place;
      });

      await this.cacheManager.set(`places/${kind}`, resp, dataset.ttl);
      return resp;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(
        `Could not read ${kind} from the city: ${error?.message ?? error}`,
      );
    }
  }

  public async getPlace(
    kind: PlaceKind,
    id: string,
  ): Promise<Place | ErrorResponse> {
    const places = await this.getPlaces(kind);
    const place = (places as PlacesResponse)[id];
    if (!place) throw new NotFoundException(`No ${kind} with id ${id}`);
    return place;
  }

  /**
   * The taxis driving around with their light on, right now.
   *
   * Its own method and its own route rather than another kind in the table:
   * everything else here is where something is, and this is what something is
   * doing. Thirty seconds against a day, a status field nothing else has, and
   * a caller that wants it on a timer rather than on launch.
   *
   * `Libre` is a taxi for hire; the set also carries `Nulo`, a cab reporting a
   * position and nothing else. Both travel, so the map can decide — filtering
   * here would leave a caller unable to tell an empty city from a broken feed.
   */
  public async getLiveTaxis(): Promise<PlacesResponse | ErrorResponse> {
    try {
      const cached: PlacesResponse = await this.cacheManager.get('taxis');
      if (cached) return cached;

      const taxis = await this.fetchAll({
        path: `${equipment}/parada-taxi/itinerantes`,
        ttl: LIVE_TTL,
        extra: (place) => ({ status: place.estado }),
      });

      const resp: PlacesResponse = {};
      taxis.forEach((taxi) => {
        resp[taxi.id] = taxi;
      });

      await this.cacheManager.set('taxis', resp, LIVE_TTL);
      return resp;
    } catch (error) {
      throw new InternalServerErrorException(
        `Could not read live taxis from the city: ${error?.message ?? error}`,
      );
    }
  }

  /** The sets this carries rather than fetches. */
  private held(kind: PlaceKind): Place[] {
    return kind === 'taxi-office' ? offices : [];
  }

  /**
   * Every page of a dataset.
   *
   * `rows` is capped at five hundred whatever is asked for, so a set larger
   * than that would come back a page at a time and look like the whole of it.
   * None of the sets left here reach five hundred, which is exactly the kind
   * of thing that stays true until the city publishes one that does.
   */
  private async fetchAll(dataset: Dataset): Promise<Place[]> {
    const places: Place[] = [];
    let start = 0;
    let total = Infinity;

    while (start < total) {
      const url = `${dataset.path}.json?srsname=wgs84&rows=${PAGE}&start=${start}`;
      const data = await fetchWithTimeout<CityResponse>(this.httpService, url);
      const rows = data?.result ?? [];
      total = data?.totalCount ?? rows.length;
      if (!rows.length) break;

      rows.forEach((row) => {
        const place = this.toPlace(row, dataset);
        if (place) places.push(place);
      });
      start += PAGE;
    }

    return places;
  }

  /**
   * One row, in this app's shape.
   *
   * Longitude first in the city's array, as GeoJSON has it. A row whose point
   * does not parse is dropped: it cannot be drawn, and a pair of NaNs sorts to
   * the front of every distance list that meets it.
   */
  private toPlace(row: CityPlace, dataset: Dataset): Place | null {
    const [longitude, latitude] = row.geometry?.coordinates ?? [];
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

    const title = row.title?.trim();

    return {
      id: String(row.id),
      // The city writes its streets in capitals, which is a shout in a list of
      // sentence-cased stops. The same fix the bus stops already get.
      title: title ? capitalizeEachWord(title) : String(row.id),
      latitude,
      longitude,
      ...dataset.extra?.(row),
    };
  }
}
