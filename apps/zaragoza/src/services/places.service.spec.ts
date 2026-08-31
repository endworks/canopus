import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { PlacesService } from './places.service';
import { PlacesResponse } from '../models/place.interface';

/** One row in the city's envelope, with only what the mapping reads. */
const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'CALLE ALCALDE GOMEZ LAGUNA, 25',
  geometry: { type: 'Point', coordinates: [-0.9097, 41.6417] },
  ...extra,
});

describe('PlacesService', () => {
  let service: PlacesService;
  let get: jest.Mock;
  let cache: { get: jest.Mock; set: jest.Mock };

  const respond = (...pages: { totalCount: number; result: unknown[] }[]) => {
    pages.forEach((page) => get.mockReturnValueOnce(of({ data: page })));
  };

  beforeEach(async () => {
    get = jest.fn();
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlacesService,
        { provide: HttpService, useValue: { get } },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    service = module.get(PlacesService);
  });

  it('refuses a kind it does not serve', async () => {
    await expect(service.getPlaces('museum' as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('asks the city in WGS84, or the points are UTM metres', async () => {
    respond({ totalCount: 1, result: [row(60)] });
    await service.getPlaces('taxi-rank');
    expect(get.mock.calls[0][0]).toContain('srsname=wgs84');
  });

  it('keys by id and sentence-cases the shouted street', async () => {
    respond({ totalCount: 1, result: [row(60)] });
    const places = (await service.getPlaces('taxi-rank')) as PlacesResponse;

    expect(Object.keys(places)).toEqual(['60']);
    expect(places['60'].title).toBe('Calle Alcalde Gomez Laguna, 25');
    expect(places['60'].latitude).toBe(41.6417);
    expect(places['60'].longitude).toBe(-0.9097);
  });

  // The city caps `rows` at five hundred however many are asked for, so a set
  // larger than that comes back looking complete unless every page is read.
  it('reads every page', async () => {
    respond(
      {
        totalCount: 501,
        result: Array.from({ length: 500 }, (_, i) => row(i)),
      },
      { totalCount: 501, result: [row(500)] },
    );

    const places = (await service.getPlaces('taxi-rank')) as PlacesResponse;

    expect(Object.keys(places)).toHaveLength(501);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toContain('start=500');
  });

  it('drops a row whose point will not parse', async () => {
    respond({
      totalCount: 2,
      result: [
        row(1),
        { id: 2, title: 'Nowhere', geometry: { coordinates: [] } },
      ],
    });

    const places = (await service.getPlaces('taxi-rank')) as PlacesResponse;
    expect(Object.keys(places)).toEqual(['1']);
  });

  it('reads a chemist as its duty shift, not its own hours', async () => {
    respond({
      totalCount: 1,
      result: [
        row(8934, {
          title: 'Farmacia Triadu',
          telefonos: '976 57 34 37',
          calle: 'Calle Río Piedra',
          horario: 'Lunes a Domingo 24 horas',
          guardia: {
            fecha: '2026-08-30T00:00:00',
            horario: 'Abiertas de 9:15 h.',
            sector: 'Sector',
          },
        }),
      ],
    });

    const places = (await service.getPlaces('pharmacy')) as PlacesResponse;

    expect(places['8934'].phone).toBe('976573437');
    expect(places['8934'].schedule).toBe('Abiertas de 9:15 h.');
    expect(places['8934'].address).toBe('Calle Río Piedra');
    expect(places['8934'].date).toBe('2026-08-30T00:00:00');
  });

  it('hands over the cooperatives without asking the city', async () => {
    const offices = (await service.getPlaces('taxi-office')) as PlacesResponse;

    expect(get).not.toHaveBeenCalled();
    expect(offices['radio-taxi-75'].phone).toBe('976757575');
    expect(offices['radio-taxi-zaragoza'].phone).toBe('976424242');
  });

  it('keeps a taxi that is not for hire, and says which it is', async () => {
    respond({
      totalCount: 2,
      result: [row(1, { estado: 'Libre' }), row(2, { estado: 'Nulo' })],
    });

    const taxis = (await service.getLiveTaxis()) as PlacesResponse;

    expect(taxis['1'].status).toBe('Libre');
    expect(taxis['2'].status).toBe('Nulo');
  });

  it('serves a cached answer without asking again', async () => {
    cache.get.mockResolvedValue({ 60: { id: '60' } });
    await service.getPlaces('taxi-rank');
    expect(get).not.toHaveBeenCalled();
  });

  it('has nothing to say about an id it does not hold', async () => {
    respond({ totalCount: 1, result: [row(60)] });
    await expect(service.getPlace('taxi-rank', '999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
