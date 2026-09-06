import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import {
  cityState,
  electricBikes,
  gbfsState,
  GbfsClient,
  pairByPosition,
} from './gbfs';

const http = (get: jest.Mock) => ({ get }) as unknown as HttpService;

describe('gbfsState', () => {
  it('reads a rack that is working as in service', () => {
    expect(
      gbfsState({
        station_id: '1',
        is_installed: true,
        is_renting: true,
        is_returning: true,
      }),
    ).toBe('IN_SERVICE');
  });

  // A full rack still hands out bikes, and telling somebody riding towards it
  // that it is closed sends them to the wrong rack.
  it('keeps a rack that will not take a bike back apart from a closed one', () => {
    expect(
      gbfsState({
        station_id: '1',
        is_installed: true,
        is_renting: true,
        is_returning: false,
      }),
    ).toBe('NOT_RETURNING');

    expect(
      gbfsState({
        station_id: '1',
        is_installed: true,
        is_renting: false,
        is_returning: true,
      }),
    ).toBe('NOT_RENTING');
  });

  it('reads a rack that is not there as closed', () => {
    expect(gbfsState({ station_id: '1', is_installed: false })).toBe('CLOSED');
  });

  // Some feeds still write these as 0 and 1 rather than as booleans.
  it('reads the flags whether they are booleans or numbers', () => {
    expect(
      gbfsState({
        station_id: '1',
        is_installed: 1,
        is_renting: 0,
        is_returning: 1,
      }),
    ).toBe('NOT_RENTING');
  });

  // A feed that omits them is a feed that has nothing to complain about.
  it('takes a rack that says nothing to be working', () => {
    expect(gbfsState({ station_id: '1' })).toBe('IN_SERVICE');
  });
});

describe('cityState', () => {
  it('says what the city says in the words the endpoint promises', () => {
    expect(cityState('ABIERTA')).toBe('IN_SERVICE');
    expect(cityState('cerrada')).toBe('CLOSED');
    expect(cityState(' Fuera de Servicio ')).toBe('CLOSED');
  });

  // Guessing at a word nobody has seen would read as a fact.
  it('hands back a word it does not know rather than inventing one', () => {
    expect(cityState('EN OBRAS')).toBe('EN OBRAS');
  });

  it('has nothing to say about a station that reported nothing', () => {
    expect(cityState(undefined)).toBeNull();
    expect(cityState('')).toBeNull();
  });
});

describe('electricBikes', () => {
  it('counts the types that declare themselves electric', () => {
    expect(
      electricBikes({
        station_id: '1',
        vehicle_types_available: [
          { vehicle_type_id: 'electric_bike', count: 4 },
          { vehicle_type_id: 'bike', count: 3 },
        ],
      }),
    ).toBe(4);
  });

  it('reads the older feeds, which key the counts by type', () => {
    expect(
      electricBikes({
        station_id: '1',
        num_bikes_available_types: { ebike: 2, mechanical: 5 },
      }),
    ).toBe(2);
  });

  // Nought would read as a rack with no electric bike on it, which is a
  // different thing from a feed that does not say.
  it('says nothing at all where the feed does not break the count down', () => {
    expect(
      electricBikes({ station_id: '1', num_bikes_available: 7 }),
    ).toBeUndefined();

    expect(
      electricBikes({
        station_id: '1',
        vehicle_types_available: [{ vehicle_type_id: 'bike', count: 3 }],
      }),
    ).toBeUndefined();
  });
});

describe('pairByPosition', () => {
  const city = (id: string, lon: number, lat: number) => ({
    id,
    coordinates: [`${lon}`, `${lat}`],
  });

  it('pairs two records of the same rack', () => {
    const paired = pairByPosition(
      [city('001', -0.8773, 41.6561)],
      [{ station_id: 'zgz-42', lon: -0.87732, lat: 41.65612 }],
    );

    expect(paired.get('001')).toBe('zgz-42');
  });

  it('leaves a rack the operator does not publish unpaired', () => {
    const paired = pairByPosition(
      [city('001', -0.8773, 41.6561)],
      [{ station_id: 'zgz-42', lon: -0.9235, lat: 41.6334 }],
    );

    expect(paired.size).toBe(0);
  });

  // Two racks at the same junction must not both claim the nearer of the
  // operator's two.
  it("spends each of the operator's stations once, nearest first", () => {
    const paired = pairByPosition(
      [city('001', -0.8773, 41.6561), city('002', -0.87731, 41.65611)],
      [
        { station_id: 'near', lon: -0.877305, lat: 41.656105 },
        { station_id: 'far', lon: -0.87735, lat: 41.65615 },
      ],
    );

    expect(new Set(paired.values()).size).toBe(2);
    expect(paired.size).toBe(2);
  });

  it('drops a record whose point will not parse', () => {
    const paired = pairByPosition(
      [{ id: '001', coordinates: [] }],
      [{ station_id: 'zgz-42', lon: -0.8773, lat: 41.6561 }],
    );

    expect(paired.size).toBe(0);
  });
});

describe('GbfsClient', () => {
  const discovery = {
    data: {
      es: {
        feeds: [
          { name: 'station_information', url: 'https://feed/info.json' },
          { name: 'station_status', url: 'https://feed/status.json' },
        ],
      },
    },
  };

  it('is not there at all without a URL for it', async () => {
    const get = jest.fn();
    const client = new GbfsClient(http(get), undefined);

    expect(client.enabled).toBe(false);
    await expect(client.stationStatus()).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it('finds its feeds through the discovery document', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(of({ data: discovery }))
      .mockReturnValueOnce(
        of({ data: { data: { stations: [{ station_id: '1' }] } } }),
      );

    const client = new GbfsClient(http(get), 'https://feed/gbfs.json');
    const stations = await client.stationStatus();

    expect(stations).toEqual([{ station_id: '1' }]);
    expect(get.mock.calls[1][0]).toBe('https://feed/status.json');
  });

  // GBFS 3 dropped the language key; the versions before it all had one.
  it('reads a listing that is not keyed by language', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(
        of({
          data: {
            data: {
              feeds: [{ name: 'station_status', url: 'https://feed/s.json' }],
            },
          },
        }),
      )
      .mockReturnValueOnce(of({ data: { data: { stations: [] } } }));

    const client = new GbfsClient(http(get), 'https://feed/gbfs.json');
    await client.stationStatus();

    expect(get.mock.calls[1][0]).toBe('https://feed/s.json');
  });

  // These URLs are a property of the deployment, not of the request.
  it('reads the discovery document once, not once a station', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(of({ data: discovery }))
      .mockReturnValue(of({ data: { data: { stations: [] } } }));

    const client = new GbfsClient(http(get), 'https://feed/gbfs.json');
    await client.stationStatus();
    await client.stationStatus();

    expect(get).toHaveBeenCalledTimes(3);
  });

  // A process that failed to read it once must not stay broken for good.
  it('tries the discovery document again after it fails', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('down')))
      .mockReturnValueOnce(of({ data: discovery }))
      .mockReturnValueOnce(of({ data: { data: { stations: [] } } }));

    const client = new GbfsClient(http(get), 'https://feed/gbfs.json');
    await expect(client.stationStatus()).rejects.toThrow();
    await expect(client.stationStatus()).resolves.toEqual([]);
  });

  it('refuses a feed the operator does not publish', async () => {
    const get = jest.fn().mockReturnValueOnce(
      of({
        data: {
          data: { es: { feeds: [{ name: 'system_information', url: 'x' }] } },
        },
      }),
    );

    const client = new GbfsClient(http(get), 'https://feed/gbfs.json');
    await expect(client.stationStatus()).rejects.toThrow(
      /publishes no station_status/,
    );
  });
});
