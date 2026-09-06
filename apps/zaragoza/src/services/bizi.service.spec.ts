import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { getModelToken } from '@nestjs/mongoose';
import { of, throwError } from 'rxjs';
import { BiziService } from './bizi.service';
import { BiziStationResponse } from '../models/bizi.interface';
import { BiziStation } from '../schemas/bizi.schema';

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
  let cache: { get: jest.Mock; set: jest.Mock };
  let findOne: jest.Mock;
  let findOneAndUpdate: jest.Mock;

  beforeEach(async () => {
    get = jest.fn();
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) });
    findOneAndUpdate = jest
      .fn()
      .mockReturnValue({ lean: () => Promise.resolve(null) });

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
      ],
    }).compile();

    service = module.get(BiziService);
  });

  const holds = (backup: BiziStation | null) =>
    findOne.mockReturnValue({ lean: () => Promise.resolve(backup) });

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
      expect(resp.state).toBe('ABIERTA');
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
  });
});
