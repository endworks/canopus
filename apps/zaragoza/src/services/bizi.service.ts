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
import { capitalizeEachWord, fixWords, notFoundById } from '../utils';

const biziApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/estacion-bicicleta.json';
const biziStationApiURL =
  'https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/estacion-bicicleta';

/** The city hands out 50 rows of this set at a time. */
const PAGE = 50;

/** How long a count of bikes on a rack is worth showing. */
const STATION_TTL = 10000;
/** A stored station has no counts on it to go stale. */
const STALE_STATION_TTL = 60000;

@Injectable()
export class BiziService {
  private readonly logger = new Logger(BiziService.name);

  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @InjectModel(BiziStation.name)
    private biziStationModel: Model<BiziStationDocument>,
    private httpService: HttpService,
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
   * A station, live where the city answers for it and stored where it does not.
   *
   * Behind the city's reading is the station the last update stored — where the
   * rack is and what street it is on, which is most of what a reader wants and
   * none of which the city has to be up to tell them. So an outage there is not
   * an outage of this endpoint: the counts go null, `source` says the answer is
   * ours rather than the city's, and only a station nobody has on record fails.
   *
   * The same walk the bus stops already do, and for the same reason.
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
    // The id is the caller's, so it is encoded rather than pasted: one that
    // carries a `%` or a space builds a URL the city answers 400 to, which used
    // to reach the caller as a 502 blaming Zaragoza for their typo.
    const url = `${biziStationApiURL}/${encodeURIComponent(id)}.json?srsname=wgs84`;

    try {
      const stationData = await fetchWithTimeout<BiziStationApiResponse>(
        this.httpService,
        url,
      );

      const titleParts = stationData.title.split('-');
      const streetName =
        titleParts.length > 1
          ? titleParts.slice(1).join('-').trim()
          : stationData.title;

      return {
        id: id,
        street: backup?.street || capitalizeEachWord(fixWords(streetName)),
        state: stationData.estado,
        bikes: stationData.bicisDisponibles,
        openDocks: stationData.anclajesDisponibles,
        coordinates:
          backup?.coordinates ||
          stationData.geometry.coordinates.map((coord) => coord.toString()),
        source: 'api',
        sourceUrl: stationData.about || url,
        lastUpdated: stationData.lastUpdated,
        type: 'bizi',
      };
    } catch (exception) {
      const failure = upstreamFailure(
        exception,
        'The Bizi API',
        notFoundById(id),
      );
      if (!backup) throw failure;
      this.logger.warn(`Serving the stored station ${id}: ${failure.message}`);
      return this.storedStation(backup);
    }
  }

  /**
   * The station as the last update left it: where it is and what it is called.
   * No counts, because nobody who knows them is answering — an empty rack would
   * be a lie, and a stale one worse.
   */
  private storedStation(backup: BiziStation): BiziStationResponse {
    const { _id, ...station } = backup as BiziStation & { _id?: unknown };
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
          `${biziApiURL}?start=${start}&rows=${PAGE}&srsname=wgs84`,
        );

        const page = data?.result ?? [];
        // An envelope that stops carrying `totalCount` used to leave the walk
        // with no end: `start` climbed past the set until the city refused a
        // page it could not serve, and that 400 was what the reader was told
        // about. An empty page ends it whatever the envelope says.
        total = data?.totalCount ?? start + page.length;
        if (!page.length) break;

        const stations = await Promise.all(
          page.map(async (station) => {
            const titleParts = station.title.split('-');
            const streetName =
              titleParts.length > 1
                ? titleParts.slice(1).join('-').trim()
                : station.title;

            const stationResponse: BiziStationResponse = {
              id: station.id,
              street: capitalizeEachWord(fixWords(streetName)),
              state: station.estado,
              bikes: station.bicisDisponibles,
              openDocks: station.anclajesDisponibles,
              coordinates: station.geometry.coordinates.map((coord) =>
                coord.toString(),
              ),
              source: 'api',
              sourceUrl: station.about || `${biziApiURL}?id=${station.id}`,
              lastUpdated: station.lastUpdated,
              type: 'bizi',
            };

            await this.saveStation({
              id: station.id,
              street: capitalizeEachWord(fixWords(streetName)),
              coordinates: station.geometry.coordinates.map((coord) =>
                coord.toString(),
              ),
              source: 'api',
              sourceUrl: station.about || `${biziApiURL}?id=${station.id}`,
              type: 'bizi',
            });

            return stationResponse;
          }),
        );

        allStations.push(...stations);
        start += PAGE;
      }

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
