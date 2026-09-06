import { StationBase } from './models/common.interface';
import {
  buildTramLine,
  orderAlongLine,
  orderAlongPath,
  stopKey,
  stopsOf,
  TRAM_LINE_ID,
  tramLineId,
} from './tram-line';

/**
 * The route as the operator's map draws it: the corridor, north to south, with
 * points between the stops the way a real one has them.
 */
const drawnRoute = (rows = corridor): number[][] =>
  rows.flatMap(([, , lon, lat], index) => {
    const next = rows[index + 1];
    if (!next) return [[lon, lat]];
    // A point at the stop and one halfway to the next, so the shape is not
    // simply the stops over again.
    return [
      [lon, lat],
      [(lon + next[2]) / 2, (lat + next[3]) / 2],
    ];
  });

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

describe('tramLineId', () => {
  it.each([
    ['the feed writes the line as a bare number', '1', 'L1'],
    ['the network writes it with its letter', 'L1', 'L1'],
    ['a feed shouting, or not', 'l1', 'L1'],
    ['a number padded the way the bus feeds pad theirs', '01', 'L1'],
  ])('%s', (_name, raw, expected) => {
    expect(tramLineId(raw)).toBe(expected);
  });

  it('is what the network calls its line', () => {
    expect(tramLineId('1')).toBe(TRAM_LINE_ID);
  });

  it('leaves alone a label it does not recognise', () => {
    // Guessing at a name nobody here knows is how a line ends up under an id
    // that is not any line's.
    expect(tramLineId('Lanzadera')).toBe('Lanzadera');
    expect(tramLineId('')).toBe('');
  });
});

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

describe('orderAlongPath', () => {
  it('puts the stops in the order the drawn route reaches them', () => {
    const shuffled = [corridor[3], corridor[0], corridor[4], corridor[2]];

    const ordered = orderAlongPath(stopsOf(stations(shuffled)), drawnRoute());

    expect(ordered.map((stop) => stop.street)).toEqual([
      'Parque Goya',
      'Margarita Xirgu',
      'Legaz Lacambra',
      'Clara Campoamor',
    ]);
  });

  it('leaves out a stop the route does not pass', () => {
    const ordered = orderAlongPath(
      stopsOf([
        ...stations(),
        { id: '9991', street: 'Cocheras', coordinates: ['-0.95', '41.62'] },
      ]),
      drawnRoute(),
    );

    expect(ordered.map((stop) => stop.street)).not.toContain('Cocheras');
  });

  it('orders nothing against a route that is not one', () => {
    expect(orderAlongPath(stopsOf(stations()), [[-0.9, 41.68]])).toEqual([]);
  });
});

describe('buildTramLine with the route the operator draws', () => {
  it('draws the line with the route rather than through its stops', () => {
    const path = drawnRoute();

    const line = buildTramLine(stations(), { path });

    expect(line.path).toEqual(path);
    // A tram runs the same track both ways, so the return leg is the way out
    // reversed — which the stops joined up could only approximate.
    expect(line.pathReturn).toEqual([...path].reverse());
    expect(line.stations).toEqual(['1121', '1131', '1141', '1151', '1161']);
  });

  it('turns a route drawn south to north the right way round', () => {
    const path = [...drawnRoute()].reverse();

    const line = buildTramLine(stations(), { path });

    // The stops and the shape are turned together, or the line lists its stops
    // one way round and draws itself the other.
    expect(line.stations[0]).toBe('1121');
    expect(line.path[0]).toEqual(drawnRoute()[0]);
  });

  it("falls back to the stops when the route is somebody else's shape", () => {
    // A shape a mile east: none of these stops is on it.
    const elsewhere = drawnRoute().map(([lon, lat]) => [lon + 0.02, lat]);

    const line = buildTramLine(stations(), { path: elsewhere });

    expect(line.stations).toEqual(['1121', '1131', '1141', '1151', '1161']);
    expect(line.path).toHaveLength(5);
  });

  it('falls back to the stops when the route reaches only some of them', () => {
    // Drawn along the top two stops only: the rest of the line is not on it,
    // and half a route in order is worse than the whole of it walked.
    const partial = drawnRoute(corridor.slice(0, 2));

    const line = buildTramLine(stations(), { path: partial });

    expect(line.stations).toHaveLength(5);
    expect(line.path).toHaveLength(5);
  });
});
