import {
  inZaragoza,
  parseGeoJsonPaths,
  parseKmlPath,
  projectOnPath,
  round5,
} from './geo';

describe('round5', () => {
  it('keeps a point to the metre', () => {
    expect(round5(-0.9019712)).toBe(-0.90197);
  });
});

describe('inZaragoza', () => {
  it.each([
    ['a stop on the line', [-0.90197, 41.68716], true],
    ['Madrid', [-3.7038, 40.4168], false],
    ['the null island a bad parse produces', [0, 0], false],
  ])('%s', (_name, point, expected) => {
    expect(inZaragoza(point as [number, number])).toBe(expected);
  });
});

describe('projectOnPath', () => {
  // A kilometre of due-south track, in four legs.
  const path: [number, number][] = [
    [-0.9, 41.69],
    [-0.9, 41.688],
    [-0.9, 41.686],
    [-0.9, 41.684],
    [-0.9, 41.682],
  ];

  it('orders points by how far along the route they are', () => {
    const along = [
      [-0.9, 41.689],
      [-0.9, 41.683],
      [-0.9, 41.6865],
    ].map((point) => projectOnPath(path, point as [number, number]).along);

    expect(along[0]).toBeLessThan(along[2]);
    expect(along[2]).toBeLessThan(along[1]);
  });

  it('puts a point beside the track at no distance from it', () => {
    // Twenty metres east, which is where the far platform of a stop stands.
    const { off } = projectOnPath(path, [-0.89976, 41.686]);

    expect(off).toBeLessThan(100 / 111_320);
  });

  it('says how far off a point that is not on the route is', () => {
    // Two kilometres east: another line entirely.
    const { off } = projectOnPath(path, [-0.876, 41.686]);

    expect(off).toBeGreaterThan(500 / 111_320);
  });

  it('holds a point past the end of the route at its end', () => {
    const end = projectOnPath(path, [-0.9, 41.682]).along;
    const beyond = projectOnPath(path, [-0.9, 41.66]).along;

    expect(beyond).toBe(end);
  });
});

describe('parseKmlPath', () => {
  it('reads the line a route file draws', () => {
    expect(
      parseKmlPath(`<?xml version="1.0"?>
        <kml><Document><Placemark><LineString><coordinates>
          -0.9019712,41.6871633,0.0 -0.8995901,41.6817212,0.0
        </coordinates></LineString></Placemark></Document></kml>`),
    ).toEqual([
      [-0.90197, 41.68716],
      [-0.89959, 41.68172],
    ]);
  });

  it('reads nothing from a file that draws no line', () => {
    expect(parseKmlPath('<kml><Document/></kml>')).toEqual([]);
  });
});

describe('parseGeoJsonPaths', () => {
  const line = {
    type: 'LineString',
    coordinates: [
      [-0.9019712, 41.6871633],
      [-0.8995901, 41.6817212],
    ],
  };

  const rounded = [
    [-0.90197, 41.68716],
    [-0.89959, 41.68172],
  ];

  it('reads a bare geometry', () => {
    expect(parseGeoJsonPaths(line)).toEqual([rounded]);
  });

  it('reads a collection, and leaves its markers alone', () => {
    expect(
      parseGeoJsonPaths({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-0.9, 41.6] },
          },
          { type: 'Feature', geometry: line },
        ],
      }),
    ).toEqual([rounded]);
  });

  it('reads each line of a multi-line', () => {
    expect(
      parseGeoJsonPaths({
        type: 'MultiLineString',
        coordinates: [line.coordinates, line.coordinates],
      }),
    ).toEqual([rounded, rounded]);
  });

  it('reads nothing from something that is not a map', () => {
    expect(parseGeoJsonPaths(undefined)).toEqual([]);
    expect(parseGeoJsonPaths('a string')).toEqual([]);
    expect(parseGeoJsonPaths({ version: 3 })).toEqual([]);
  });
});
