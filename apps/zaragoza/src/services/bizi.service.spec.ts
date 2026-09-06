import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { getModelToken } from '@nestjs/mongoose';
import { of, throwError } from 'rxjs';
import { BiziService } from './bizi.service';
import { BiziStationResponse } from '../models/bizi.interface';
import { BiziStation } from '../schemas/bizi.schema';
import { GbfsClient } from '../gbfs';

/** What the city answers for one station. */
const station = (extra: Record<string, unknown> = {}) => ({
  id: '001',
  title: 'Bizi - PASEO ECHEGARAY Y CABALLERO',
  estado: 'ABIERTA',
  bicisDisponibles: 7,
  anclajesDisponibles: 12,
  geometry: { type: 'Point', coordinates: [-0.8773, 41.6561] },
  lastUpdated: '2026-08-30T10:00:00Z',
  ...extra,
});

/** The station the last update stored. */
const stored = {
  _id: 'mongo-id',
  id: '001',
  street: 'Paseo Echegaray y Caballero',
  coordinates: ['-0.8773', '41.6561'],
  source: 'api',
  sourceUrl: 'https://www.zaragoza.es/sede/servicio/x/estacion-bicicleta/001',
  type: 'bizi',
} as unknown as BiziStation;

/** An axios failure carrying the status the source answered with. */
const answered = (status: number) => {
  const failed: Error & { response?: { status: number } } = new Error(
    `Request failed with status code ${status}`,
  );
  failed.response = { status };
  return failed;
};

describe('BiziService', () => {
  let service: BiziService;
  let get: jest.Mock;
  let cache: { get: jest.Mock; set: jest.Mock; wrap: jest.Mock };
  let findOne: jest.Mock;
  let findOneAndUpdate: jest.Mock;
  let gbfs: {
    enabled: boolean;
    stationStatus: jest.Mock;
    stationInformation: jest.Mock;
  };

  beforeEach(async () => {
    get = jest.fn();
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
      wrap: jest.fn((_key, read) => read()),
    };
    findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) });
    findOneAndUpdate = jest
      .fn()
      .mockReturnValue({ lean: () => Promise.resolve(null) });
    // Unconfigured by default, which is what every deployment looks like until
    // somebody points it at a feed.
    gbfs = {
      enabled: false,
      stationStatus: jest.fn(),
      stationInformation: jest.fn(),
    };

    const model = {
      find: () => ({
        sort: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
      }),
      findOne,
      findOneAndUpdate,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BiziService,
        { provide: HttpService, useValue: { get } },
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: getModelToken(BiziStation.name), useValue: model },
        { provide: GbfsClient, useValue: gbfs },
      ],
    }).compile();

    service = module.get(BiziService);
  });

  const holds = (backup: BiziStation | null) =>
    findOne.mockReturnValue({ lean: () => Promise.resolve(backup) });

  /** A deployment that has been given an operator feed, answering with these. */
  const operatorHas = (...statuses: Record<string, unknown>[]) => {
    gbfs.enabled = true;
    gbfs.stationStatus.mockResolvedValue(statuses);
  };

  describe('getStation', () => {
    it('asks the city in WGS84, or the point is UTM metres', async () => {
      get.mockReturnValueOnce(of({ data: station() }));
      await service.getStation('001');
      expect(get.mock.calls[0][0]).toContain('srsname=wgs84');
    });

    // The id is the caller's, and a raw `%` in a path is what the city answers
    // 400 to — a request nobody meant to make.
    it("encodes the caller's id into the city's URL", async () => {
      get.mockReturnValueOnce(of({ data: station() }));
      await service.getStation('a b%c');
      expect(get.mock.calls[0][0]).toContain('/a%20b%25c.json');
    });

    it('reads the counts the city reports', async () => {
      get.mockReturnValueOnce(of({ data: station() }));
      const resp = (await service.getStation('001')) as BiziStationResponse;

      expect(resp.bikes).toBe(7);
      expect(resp.openDocks).toBe(12);
      expect(resp.state).toBe('IN_SERVICE');
      expect(resp.street).toBe('Paseo Echegaray y Caballero');
      expect(resp.source).toBe('api');
    });

    // A 400 on a path whose only variable is the id means the id, not the city.
    // It used to leave here as a 502 blaming Zaragoza for somebody's typo.
    it('answers 404, not 502, for an id the city refuses', async () => {
      holds(null);
      get.mockReturnValueOnce(throwError(() => answered(400)));

      await expect(service.getStation('nonsense')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('answers 404 for an id the city has never heard of', async () => {
      holds(null);
      get.mockReturnValueOnce(throwError(() => answered(404)));

      await expect(service.getStation('999')).rejects.toMatchObject({
        status: 404,
      });
    });

    // A request we build ourselves, refused: that one really is the source's.
    it("answers 502 when the city's own server fails", async () => {
      holds(null);
      get.mockReturnValueOnce(throwError(() => answered(500)));

      await expect(service.getStation('001')).rejects.toMatchObject({
        status: 502,
      });
    });

    it('serves the stored station when the city cannot answer', async () => {
      holds(stored);
      get.mockReturnValueOnce(throwError(() => answered(500)));

      const resp = (await service.getStation('001')) as BiziStationResponse;

      expect(resp.source).toBe('backup');
      expect(resp.street).toBe('Paseo Echegaray y Caballero');
      expect(resp.coordinates).toEqual(['-0.8773', '41.6561']);
      // Nobody who knows the counts is answering, so it does not guess at them.
      expect(resp.bikes).toBeNull();
      expect(resp.openDocks).toBeNull();
      expect(resp.state).toBeNull();
      expect(resp).not.toHaveProperty('_id');
    });

    // Nothing on the rack to go stale, and holding it is what keeps an outage
    // from costing every reader the walk down the dead road.
    it('holds a stored station longer than a live one', async () => {
      holds(stored);
      get.mockReturnValueOnce(throwError(() => answered(500)));
      await service.getStation('001');
      const stale = cache.set.mock.calls[0][2];

      cache.set.mockClear();
      get.mockReturnValueOnce(of({ data: station() }));
      await service.getStation('001');
      const live = cache.set.mock.calls[0][2];

      expect(stale).toBeGreaterThan(live);
    });

    it('serves a cached answer without asking again', async () => {
      cache.get.mockResolvedValue({ id: '001', source: 'api' });
      await service.getStation('001');
      expect(get).not.toHaveBeenCalled();
    });

    it('says the same word about a state whichever road answered', async () => {
      get.mockReturnValueOnce(of({ data: station({ estado: 'ABIERTA' }) }));
      const fromCity = (await service.getStation('001')) as BiziStationResponse;

      operatorHas({
        station_id: '001',
        is_installed: true,
        is_renting: true,
        is_returning: true,
      });
      const fromOperator = (await service.getStation(
        '001',
      )) as BiziStationResponse;

      expect(fromCity.state).toBe('IN_SERVICE');
      expect(fromOperator.state).toBe('IN_SERVICE');
    });
  });

  // The operator runs the bikes and counts them itself, so it is asked first —
  // but only where a deployment has been given a feed to ask.
  describe('getStation, with an operator feed', () => {
    it('does not go near the city when the operator answers', async () => {
      holds(stored);
      operatorHas({
        station_id: '001',
        num_bikes_available: 7,
        num_docks_available: 12,
      });

      const resp = (await service.getStation('001')) as BiziStationResponse;

      expect(get).not.toHaveBeenCalled();
      expect(resp.source).toBe('operator');
      expect(resp.bikes).toBe(7);
      expect(resp.openDocks).toBe(12);
      expect(resp.street).toBe('Paseo Echegaray y Caballero');
    });

    // The whole reason for asking the operator: `bikes` alone cannot say that
    // six of the seven need pedalling.
    it('says how many of the bikes are electric', async () => {
      holds(stored);
      operatorHas({
        station_id: '001',
        num_bikes_available: 7,
        vehicle_types_available: [
          { vehicle_type_id: 'electric_bike', count: 4 },
          { vehicle_type_id: 'bike', count: 3 },
        ],
      });

      const resp = (await service.getStation('001')) as BiziStationResponse;
      expect(resp.electricBikes).toBe(4);
    });

    // The city's set does not break the count down, and a nought here would
    // read as a rack with no electric bike on it.
    it('says nothing about electric bikes on the city road', async () => {
      get.mockReturnValueOnce(of({ data: station() }));
      const resp = (await service.getStation('001')) as BiziStationResponse;
      expect(resp).not.toHaveProperty('electricBikes');
    });

    it('asks the operator by its own number for the rack', async () => {
      holds({ ...stored, gbfsId: 'zgz-42' } as BiziStation);
      operatorHas({ station_id: 'zgz-42', num_bikes_available: 3 });

      const resp = (await service.getStation('001')) as BiziStationResponse;

      expect(resp.source).toBe('operator');
      expect(resp.bikes).toBe(3);
      // The id the caller asked with is the id they get back.
      expect(resp.id).toBe('001');
    });

    it('falls through to the city for a rack the operator has not got', async () => {
      holds(stored);
      operatorHas({ station_id: 'somewhere-else' });
      get.mockReturnValueOnce(of({ data: station() }));

      const resp = (await service.getStation('001')) as BiziStationResponse;

      expect(resp.source).toBe('api');
      expect(resp.bikes).toBe(7);
    });

    it('falls through to the city when the feed will not answer', async () => {
      holds(stored);
      gbfs.enabled = true;
      gbfs.stationStatus.mockRejectedValue(new Error('feed is down'));
      get.mockReturnValueOnce(of({ data: station() }));

      const resp = (await service.getStation('001')) as BiziStationResponse;

      expect(resp.source).toBe('api');
    });

    it('still serves the stored station when both roads are down', async () => {
      holds(stored);
      gbfs.enabled = true;
      gbfs.stationStatus.mockRejectedValue(new Error('feed is down'));
      get.mockReturnValueOnce(throwError(() => answered(500)));

      const resp = (await service.getStation('001')) as BiziStationResponse;

      expect(resp.source).toBe('backup');
      expect(resp.bikes).toBeNull();
    });

    // One document for the whole system, so it is read once for all readers
    // rather than once per rack — which is the per-id request the 400 came out
    // of in the first place.
    it('reads the whole system once rather than once a station', async () => {
      holds(stored);
      operatorHas({ station_id: '001', num_bikes_available: 7 });

      await service.getStation('001');

      expect(cache.wrap).toHaveBeenCalledWith(
        'bizi/gbfs/status',
        expect.any(Function),
        expect.any(Number),
      );
    });

    it('keeps the operator id out of the answer', async () => {
      holds({ ...stored, gbfsId: 'zgz-42' } as BiziStation);
      gbfs.enabled = true;
      gbfs.stationStatus.mockRejectedValue(new Error('feed is down'));
      get.mockReturnValueOnce(throwError(() => answered(500)));

      const resp = (await service.getStation('001')) as BiziStationResponse;

      expect(resp.source).toBe('backup');
      expect(resp).not.toHaveProperty('gbfsId');
    });
  });

  describe('getStationsUpdate', () => {
    const page = (totalCount: unknown, result: unknown[]) =>
      get.mockReturnValueOnce(of({ data: { totalCount, result } }));

    it('reads every page', async () => {
      page(
        60,
        Array.from({ length: 50 }, (_, i) => station({ id: `${i}` })),
      );
      page(
        60,
        Array.from({ length: 10 }, (_, i) => station({ id: `${i + 50}` })),
      );

      await service.getStationsUpdate();

      expect(get).toHaveBeenCalledTimes(2);
      expect(get.mock.calls[1][0]).toContain('start=50');
    });

    // An envelope with no count in it used to walk `start` past the set until
    // the city refused a page, and that 400 was what the reader was told about.
    it('stops on an empty page rather than walking off the end', async () => {
      page(undefined, [station()]);
      page(undefined, []);

      await service.getStationsUpdate();

      expect(get).toHaveBeenCalledTimes(1);
    });

    // Ours to build, so a source that refuses it is a source at fault.
    it('answers 502 when the city refuses the listing', async () => {
      get.mockReturnValueOnce(throwError(() => answered(400)));

      await expect(service.getStationsUpdate()).rejects.toMatchObject({
        status: 502,
      });
    });

    it('stores the operator id of each rack it can pair', async () => {
      page(1, [station()]);
      gbfs.enabled = true;
      gbfs.stationInformation.mockResolvedValue([
        { station_id: 'zgz-42', lon: -0.87731, lat: 41.65611 },
      ]);

      await service.getStationsUpdate();

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { id: '001' },
        { $set: expect.objectContaining({ gbfsId: 'zgz-42' }) },
        expect.anything(),
      );
    });

    // Failing an update of the whole set because one of two sources is down
    // would lose the stations as well as the pairing.
    it('stores the stations anyway when the operator feed is down', async () => {
      page(1, [station()]);
      gbfs.enabled = true;
      gbfs.stationInformation.mockRejectedValue(new Error('feed is down'));

      await service.getStationsUpdate();

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { id: '001' },
        { $set: expect.objectContaining({ id: '001', gbfsId: undefined }) },
        expect.anything(),
      );
    });
  });
});
