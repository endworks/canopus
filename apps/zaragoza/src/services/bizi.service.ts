import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';
import {
  BiziApiResponse,
  BiziStationApiResponse,
} from '../models/api-responses.interface';
import {
  BiziStationResponse,
  BiziStationsResponse,
} from '../models/bizi.interface';
import { ErrorResponse } from '@canopus/shared';
import { fetchWithTimeout, upstreamFailure } from '@canopus/nest';
import { BiziStation, BiziStationDocument } from '../schemas/bizi.schema';
import {
  capitalizeEachWord,
  fixWords,
  normalizeStreet,
  notFoundById,
} from '../utils';
import {
  cityState,
  electricBikes,
  electricTypeIds,
  gbfsState,
  GbfsClient,
  GbfsStationStatus,
  pairByPosition,
  vehiclesAvailable,
} from '../gbfs';

/**
 * The city's Bizi stations.
 *
 * `.json?srsname=wgs84`, the same way every other call to the city is written:
 * `rf=html` is the flag that asks this for a web page, which is what a browser
 * sends and not what a client wants. Without `srsname` the points arrive as
 * UTM metres and are served as a longitude and a latitude.
 */
const biziApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/estacion-bicicleta';

/** How many rows of this set the city hands out at a time. */
const PAGE = 50;

/** How long a count of bikes on a rack is worth showing. */
const STATION_TTL = 10000;
/** A stored station has no counts on it to go stale. */
const STALE_STATION_TTL = 60000;
/** Where the operator's stations stand changes about never. */
const OPERATOR_INFO_TTL = 1000 * 60 * 60 * 6;

/**
 * The place a rack stands, said the way a bus stop is said.
 *
 * The city shouts its street names — "UNO DE MAYO" — and writes them without
 * the accents, which in a list of sentence-cased stops reads as a different
 * app. So a rack's name goes through the same three passes a stop's does, in
 * the same order and out of the same tables: `fixWords` repairs the mojibake
 * and the missing accents, `normalizeStreet` puts the spacing right, and
 * `capitalizeEachWord` sentence-cases it while leaving "de" and "y" alone and
 * a Roman numeral shouting.
 *
 * The spacing pass is the one this used to be missing, and it has to come
 * before the casing rather than after: `capitalizeEachWord` splits on single
 * spaces, so a doubled one reaches it as an empty word and survives into the
 * name.
 */
const cityStreet = (row: BiziStationApiResponse): string => {
  // This set writes the street into the title behind the name of the station —
  // "Bizi - PASEO ECHEGARAY Y CABALLERO" — and a title with no dash in it is
  // the street entire. Where the title says nothing, the fields the siblings in
  // this family carry the street in, which this one sometimes fills too.
  const title = row.title?.trim() ?? '';
  const parts = title.split('-');
  const fromTitle = parts.length > 1 ? parts.slice(1).join('-').trim() : title;
  const raw = fromTitle || row.address?.trim() || row.calle?.trim() || '';

  return capitalizeEachWord(normalizeStreet(fixWords(raw))) ?? '';
};

/**
 * Where the rack is, as strings. Empty where the row carries no point that
 * parses — the same rows `places` drops, except that here the rack is still
 * worth serving: a reader who knows which station they mean wants its counts
 * whether or not the city can say where it stands.
 */
const cityPoint = (row: BiziStationApiResponse): string[] =>
  (row.geometry?.coordinates ?? [])
    .filter((coord) => Number.isFinite(coord))
    .map((coord) => coord.toString());

@Injectable()
export class BiziService {
  private readonly logger = new Logger(BiziService.name);

  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(BiziStation.name)
    private biziStationModel: Model<BiziStationDocument>,
    private httpService: HttpService,
    private readonly gbfs: GbfsClient,
  ) {}

  public async getStations(): Promise<BiziStationsResponse | ErrorResponse> {
    try {
      const cache: BiziStationsResponse =
        await this.cacheManager.get('bizi/stations');
      if (cache) return cache;

      const resp: BiziStationsResponse = {};
      const stations = await this.getAllStations();
      stations.forEach((station) => {
        const { _id, ...stationWithoutId } = station;
        resp[station.id] = {
          ...stationWithoutId,
          state: null,
          bikes: null,
          openDocks: null,
        };
      });
      await this.cacheManager.set(`bizi/stations`, resp);
      return resp;
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
        },
        exception.message,
      );
    }
  }

  /**
   * A station, by whichever road can still answer for it.
   *
   * Three roads, in the order of who knows best. The operator runs the bikes
   * and counts them itself, so its feed is asked first where this deployment
   * has been given one. The city's set is the second road — a mirror of the
   * same racks, and the one this service was built on. Behind both is the
   * station the last update stored: where the rack is and what street it is
   * on, which is most of what a reader wants and none of which anybody has to
   * be up to tell them.
   *
   * So an outage at either source is not an outage of this endpoint: the
   * counts go null, `source` says the answer is ours rather than theirs, and
   * only a station nobody has on record fails. The same walk the bus stops
   * already do, and for the same reason.
   */
  public async getStation(
    id: string,
  ): Promise<BiziStationResponse | ErrorResponse> {
    const cache: BiziStationResponse = await this.cacheManager.get(
      `bizi/stations/${id}`,
    );
    if (cache) return cache;

    const backup = await this.getStationById(id);
    const resp = await this.readStation(id, backup);

    // Ten seconds is how long a count of free bikes means anything. A stored
    // station has no count on it to go stale, and holding it longer is what
    // keeps an outage from costing every reader the walk down the dead road.
    await this.cacheManager.set(
      `bizi/stations/${id}`,
      resp,
      resp.source === 'backup' ? STALE_STATION_TTL : STATION_TTL,
    );

    return resp;
  }

  private async readStation(
    id: string,
    backup: BiziStation | null,
  ): Promise<BiziStationResponse> {
    const fromOperator = await this.operatorStation(id, backup);
    if (fromOperator) return fromOperator;

    try {
      return await this.cityStation(id, backup);
    } catch (failure) {
      // A station the city says it has never heard of, with nothing stored
      // behind it, does not exist: there is nothing left to serve, and the
      // 404 is the answer rather than a road that failed.
      if (!backup) throw failure;
      this.logger.warn(`Serving the stored station ${id}: ${failure.message}`);
      return this.storedStation(backup);
    }
  }

  /**
   * The station as the operator counts it, or nothing.
   *
   * Nothing, rather than a failure, on purpose: this is the first of three
   * roads, and everything it can go wrong on — no feed configured, a feed that
   * is down, a rack this deployment has not paired yet — is something the city
   * can still answer. Only the caller below decides that nobody could.
   *
   * The status feed is one document for the whole system, so it is fetched
   * once for all readers rather than once per station. That is most of why
   * this road is worth having: the city has to be asked about each rack
   * separately, and asking it about one rack is what a 502 used to come out of.
   */
  private async operatorStation(
    id: string,
    backup: BiziStation | null,
  ): Promise<BiziStationResponse | null> {
    if (!this.gbfs.enabled) return null;

    let statuses: GbfsStationStatus[];
    try {
      statuses = await this.cacheManager.wrap(
        'bizi/gbfs/status',
        () => this.gbfs.stationStatus(),
        STATION_TTL,
      );
    } catch (exception) {
      this.logger.warn(
        `Could not read the operator's feed: ${exception.message}`,
      );
      return null;
    }

    const wanted = await this.operatorIdFor(id, backup);
    const status = statuses.find((station) => station.station_id === wanted);
    if (!status) return null;

    const electric = electricBikes(status, await this.electricTypes());
    return {
      id,
      street: backup?.street ?? capitalizeEachWord(fixWords(id)),
      state: gbfsState(status),
      bikes: vehiclesAvailable(status),
      ...(electric === undefined ? {} : { electricBikes: electric }),
      openDocks: status.num_docks_available ?? null,
      coordinates: backup?.coordinates ?? [],
      source: 'operator',
      sourceUrl: null,
      lastUpdated: new Date().toISOString(),
      type: 'bizi',
    };
  }

  /**
   * Which of the system's vehicle types are electric, as the system says.
   *
   * Which kinds a system runs is furniture too, so it is read on the same slow
   * clock as the stations. An empty set means the feed declared nothing, and
   * `electricBikes` falls back to reading the type's id — which is all anybody
   * could do before, and is right only for a feed that names its types.
   */
  private async electricTypes(): Promise<Set<string>> {
    try {
      return await this.cacheManager.wrap(
        'bizi/gbfs/vehicle-types',
        async () => electricTypeIds(await this.gbfs.vehicleTypes()),
        OPERATOR_INFO_TTL,
      );
    } catch (exception) {
      this.logger.warn(
        `Could not read the operator's vehicle types: ${exception.message}`,
      );
      return new Set();
    }
  }

  /**
   * The operator's own number for this station.
   *
   * The last update's pairing where there is one. Where there is not — a
   * station added since, or a deployment that has read the feed before it has
   * run an update — the pairing below stands in, so that turning the feed on
   * does something before somebody remembers to run the update. A road that
   * does nothing is indistinguishable from a road that is down.
   */
  private async operatorIdFor(
    id: string,
    backup: BiziStation | null,
  ): Promise<string> {
    if (backup?.gbfsId) return backup.gbfsId;
    // Some systems number their stations the way the city does, so the
    // caller's id is worth trying when nothing else answers.
    return (await this.pairings())[id] ?? id;
  }

  /**
   * Every station paired with the operator's, worked out at once.
   *
   * At once, rather than a station at a time as it is asked for, because
   * pairing is a competition: `pairByPosition` spends each of the operator's
   * stations on its nearest claimant, and a station asked about on its own has
   * nobody to lose to. One whose real counterpart is missing from the feed
   * would take the neighbour forty metres away and serve that rack's bikes as
   * its own — a wrong answer, where the whole point of this road is that it is
   * a right one. Pairing the whole set is what makes a station either matched
   * or unmatched rather than matched to whatever was nearest.
   *
   * So this is the same call the update makes, over the same two sets, and the
   * two agree by construction. Cached six hours because where a rack stands is
   * furniture: it costs one read of each source, not one per reader.
   */
  private async pairings(): Promise<Record<string, string>> {
    try {
      return await this.cacheManager.wrap(
        'bizi/gbfs/pairings',
        async () => {
          const [stations, operator] = await Promise.all([
            this.getAllStations(),
            this.gbfs.stationInformation(),
          ]);
          // A plain object rather than the Map it is built as: this goes
          // through a cache that a deployment is free to move off the heap.
          return Object.fromEntries(pairByPosition(stations, operator));
        },
        OPERATOR_INFO_TTL,
      );
    } catch (exception) {
      this.logger.warn(
        `Could not pair the stations with the operator's feed: ${exception.message}`,
      );
      return {};
    }
  }

  /** The station as the city mirrors it: one request, for this rack alone. */
  private async cityStation(
    id: string,
    backup: BiziStation | null,
  ): Promise<BiziStationResponse> {
    // The id is the caller's, so it is encoded rather than pasted: one that
    // carries a `%` or a space builds a URL the city answers 400 to, which used
    // to reach the caller as a 502 blaming Zaragoza for their typo.
    const url = `${biziApiURL}/${encodeURIComponent(id)}.json?srsname=wgs84`;

    try {
      const row = await fetchWithTimeout<BiziStationApiResponse>(
        this.httpService,
        url,
      );

      return {
        id: id,
        street: backup?.street || cityStreet(row),
        state: cityState(row.estado ?? row.estadoEstacion),
        // Null rather than nought where the row does not carry a count: nought
        // is a station somebody rides to and finds empty, and a row that says
        // nothing has not said that.
        bikes: row.bicisDisponibles ?? null,
        openDocks: row.anclajesDisponibles ?? null,
        coordinates: backup?.coordinates || cityPoint(row),
        source: 'api',
        sourceUrl: row.about || url,
        lastUpdated: row.lastUpdated,
        type: 'bizi',
      };
    } catch (exception) {
      throw upstreamFailure(exception, 'The Bizi API', notFoundById(id));
    }
  }

  /**
   * The station as the last update left it: where it is and what it is called.
   * No counts, because nobody who knows them is answering — an empty rack would
   * be a lie, and a stale one worse.
   */
  private storedStation(backup: BiziStation): BiziStationResponse {
    // `gbfsId` is how the two sources are joined up, which is bookkeeping: a
    // reader asking where the bikes are has no use for the operator's own
    // number for the rack.
    const { _id, gbfsId, ...station } = backup as BiziStation & {
      _id?: unknown;
    };
    return {
      ...station,
      state: null,
      bikes: null,
      openDocks: null,
      source: 'backup',
    };
  }

  public async getStationsUpdate(): Promise<
    BiziStationsResponse | ErrorResponse
  > {
    try {
      const allStations: BiziStationResponse[] = [];
      let start = 0;
      let total = Infinity;

      while (start < total) {
        const data = await fetchWithTimeout<BiziApiResponse>(
          this.httpService,
          `${biziApiURL}.json?srsname=wgs84&rows=${PAGE}&start=${start}`,
        );

        const page = data?.result ?? [];
        // An envelope that stops carrying `totalCount` used to leave the walk
        // with no end: `start` climbed past the set until the city refused a
        // page it could not serve, and that 400 was what the reader was told
        // about. An empty page ends it whatever the envelope says.
        total = data?.totalCount ?? start + page.length;
        if (!page.length) break;

        page.forEach((row) => {
          const id = String(row.id);
          allStations.push({
            id,
            street: cityStreet(row),
            state: cityState(row.estado ?? row.estadoEstacion),
            bikes: row.bicisDisponibles ?? null,
            openDocks: row.anclajesDisponibles ?? null,
            coordinates: cityPoint(row),
            source: 'api',
            sourceUrl:
              row.about ||
              `${biziApiURL}/${encodeURIComponent(id)}.json?srsname=wgs84`,
            lastUpdated: row.lastUpdated,
            type: 'bizi',
          });
        });

        start += PAGE;
      }

      // Every station of both sources is in hand before anything is written:
      // pairing a rack needs to see all of the operator's racks to know which
      // of them is nearest, which a page at a time cannot.
      const paired = await this.pairWithOperator(allStations);

      await Promise.all(
        allStations.map((station) =>
          this.saveStation({
            id: station.id,
            street: station.street,
            coordinates: station.coordinates,
            gbfsId: paired.get(station.id),
            source: station.source,
            sourceUrl: station.sourceUrl,
            type: 'bizi',
          }),
        ),
      );

      const resp: BiziStationsResponse = {};
      allStations.forEach((station) => {
        resp[station.id] = station;
      });

      await this.cacheManager.set('bizi/stations', resp);
      return resp;
    } catch (exception) {
      throw upstreamFailure(exception, 'The Bizi API');
    }
  }

  /**
   * Which of the operator's racks is which of the city's, by where they stand.
   *
   * Nothing here can fail the update. A feed that is not configured or will
   * not answer leaves every station unpaired, which is exactly where they were
   * before the operator was a road at all: asked about on the city's, which
   * still works. The alternative — failing an update of the whole set because
   * one of two sources is down — would lose the stations as well as the
   * pairing.
   */
  private async pairWithOperator(
    stations: BiziStationResponse[],
  ): Promise<Map<string, string>> {
    if (!this.gbfs.enabled) return new Map();

    try {
      const operator = await this.gbfs.stationInformation();
      const paired = pairByPosition(stations, operator);
      this.logger.log(
        `Paired ${paired.size} of ${stations.length} stations with ${operator.length} the operator publishes`,
      );
      return paired;
    } catch (exception) {
      this.logger.warn(
        `Could not pair the stations with the operator's feed: ${exception.message}`,
      );
      return new Map();
    }
  }

  async getAllStations() {
    return this.biziStationModel.find().sort({ id: 1 }).lean().exec();
  }

  async getStationById(id: string) {
    return this.biziStationModel.findOne({ id }).lean();
  }

  async saveStation(data: Partial<BiziStation>) {
    return this.biziStationModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { returnDocument: 'after', upsert: true },
      )
      .lean();
  }
}
