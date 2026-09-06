import { StationBase } from './models/common.interface';
import {
  buildTramLine,
  orderAlongLine,
  stopKey,
  stopsOf,
  TRAM_LINE_ID,
} from './tram-line';

/**
 * A stretch of the real thing: five stops of the corridor the line runs, north
 * to south, each with the two platforms the city stores separately.
 */
const corridor: [string, string, number, number][] = [
  ['112', 'Parque Goya', -0.90197, 41.68716],
  ['113', 'Adolfo Aznar', -0.89959, 41.68172],
  ['114', 'Margarita Xirgu', -0.89523, 41.67318],
  ['115', 'Legaz Lacambra', -0.89224, 41.66702],
  ['116', 'Clara Campoamor', -0.88938, 41.66104],
];

/** The two platform records the city publishes for one stop. */
const platforms = ([key, street, lon, lat]: [
  string,
  string,
  number,
  number,
]): StationBase[] => [
  { id: `${key}1`, street, coordinates: [`${lon}`, `${lat}`] },
  // The far platform, a few metres across the track.
  { id: `${key}2`, street, coordinates: [`${lon + 0.0001}`, `${lat}`] },
];

const stations = (rows = corridor): StationBase[] => rows.flatMap(platforms);

describe('stopKey', () => {
  it('drops the platform digit the arrivals lookup already relies on', () => {
    expect(stopKey('1121')).toBe('112');
    expect(stopKey('1122')).toBe('112');
  });
});

describe('stopsOf', () => {
  it('pairs the platform records the city stores separately', () => {
    const stops = stopsOf(stations());

    expect(stops).toHaveLength(corridor.length);
    expect(stops[0].platforms).toEqual(['1121', '1122']);
    expect(stops[0].street).toBe('Parque Goya');
  });

  it('places a stop between its platforms', () => {
    const [stop] = stopsOf(platforms(corridor[0]));

    expect(stop.point[1]).toBe(41.68716);
    // Halfway across the track, and rounded to the metre the rest is kept to.
    expect(stop.point[0]).toBeCloseTo(-0.90192, 5);
  });

  it('leaves out a record with no point on it', () => {
    const stops = stopsOf([
      ...platforms(corridor[0]),
      { id: '9991', street: 'Nowhere', coordinates: [] },
      { id: '9992', street: 'Nowhere', coordinates: ['', ''] },
    ]);

    expect(stops.map((stop) => stop.key)).toEqual(['112']);
  });

  it('keeps a stop that publishes only one platform', () => {
    const stops = stopsOf([platforms(corridor[0])[0]]);

    expect(stops[0].platforms).toEqual(['1121']);
  });
});

describe('orderAlongLine', () => {
  it('puts the stops in the order the line runs them', () => {
    // Shuffled: nothing about the input order may reach the answer.
    const shuffled = [
      corridor[3],
      corridor[0],
      corridor[4],
      corridor[2],
      corridor[1],
    ];

    const ordered = orderAlongLine(stopsOf(stations(shuffled)));

    expect(ordered.map((stop) => stop.street)).toEqual([
      'Parque Goya',
      'Adolfo Aznar',
      'Margarita Xirgu',
      'Legaz Lacambra',
      'Clara Campoamor',
    ]);
  });

  it('runs north to south whichever end it started from', () => {
    const northFirst = orderAlongLine(stopsOf(stations()));
    const southFirst = orderAlongLine(
      stopsOf(stations([...corridor].reverse())),
    );

    expect(northFirst.map((stop) => stop.key)).toEqual(
      southFirst.map((stop) => stop.key),
    );
    expect(northFirst[0].street).toBe('Parque Goya');
  });

  it('leaves a pair of stops alone', () => {
    const stops = stopsOf(stations(corridor.slice(0, 2)));

    expect(orderAlongLine(stops)).toHaveLength(2);
  });
});

describe('buildTramLine', () => {
  it('calls at each stop once on each leg, on its own platform', () => {
    const line = buildTramLine(stations());

    expect(line.id).toBe(TRAM_LINE_ID);
    expect(line.stations).toEqual(['1121', '1131', '1141', '1151', '1161']);
    // The same places the other way round — and the other platform of each,
    // which is the whole reason for publishing the return leg.
    expect(line.stationsReturn).toEqual([
      '1162',
      '1152',
      '1142',
      '1132',
      '1122',
    ]);
  });

  it('names the line after the two places it runs between', () => {
    expect(buildTramLine(stations()).name).toBe(
      'Parque Goya - Clara Campoamor',
    );
  });

  it('draws each leg through the stops it calls at', () => {
    const line = buildTramLine(stations());

    expect(line.path).toHaveLength(line.stations.length);
    expect(line.path[0]).toEqual([-0.90192, 41.68716]);
    // The return leg is drawn the way it runs, not the way out.
    expect(line.pathReturn[0]).toEqual(line.path[line.path.length - 1]);
  });

  it('falls back to the one platform a stop publishes', () => {
    const line = buildTramLine([
      ...stations(corridor.slice(0, 2)),
      platforms(corridor[2])[0],
    ]);

    expect(line.stationsReturn[0]).toBe('1141');
  });

  it('builds nothing from stops that are not a line', () => {
    expect(buildTramLine([])).toBeNull();
    expect(buildTramLine(platforms(corridor[0]))).toBeNull();
  });
});
