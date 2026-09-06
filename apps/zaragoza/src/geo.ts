import * as cheerio from 'cheerio';

/** A point, `[longitude, latitude]`, the way every source here writes one. */
export type Point = [number, number];

/**
 * Five decimal places, about a metre.
 *
 * The sources carry seven, which is centimetres — a precision nobody looking
 * at a transport map can see and which costs a third of the payload to send.
 */
export const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;

/**
 * Zaragoza and a good margin around it.
 *
 * Coordinates read out of somebody's page are numbers until something says
 * they are places. A version string, a set of pixel offsets and an analytics
 * id all parse as a pair of floats; only a pair that lands in the city is a
 * point on a tram route.
 */
const bounds = { west: -1.05, east: -0.75, south: 41.55, north: 41.75 };

export const inZaragoza = ([lon, lat]: Point): boolean =>
  lon >= bounds.west &&
  lon <= bounds.east &&
  lat >= bounds.south &&
  lat <= bounds.north;

// Longitude degrees are shorter than latitude ones, by the cosine of the
// latitude. At Zaragoza's it is about 0.75, which is more than enough to put
// two stops in the wrong order if it is ignored.
const lonScale = Math.cos((41.65 * Math.PI) / 180);

/**
 * How far apart two points are, in degrees of latitude.
 *
 * Not metres: nothing here needs a distance in units, only distances that can
 * be compared with each other, and a flat approximation over a city is exact
 * enough for that to the centimetre.
 */
export const distance = (a: Point, b: Point): number => {
  const dx = (a[0] - b[0]) * lonScale;
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * How far along a path a point sits, and how far off it.
 *
 * The point is dropped onto each leg of the path in turn — clamped to the leg,
 * so a point beyond one end lands on that end — and the nearest of those is
 * where it belongs. `along` is the distance from the start of the path to
 * there, which is what orders a set of points by the route rather than by the
 * crow; `off` is how far the point was from the path, which is what says
 * whether it is on the route at all.
 */
export const projectOnPath = (
  path: Point[],
  point: Point,
): { along: number; off: number } => {
  let best = { along: 0, off: Infinity };
  let travelled = 0;

  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i];
    const to = path[i + 1];
    const dx = (to[0] - from[0]) * lonScale;
    const dy = to[1] - from[1];
    const legLength = Math.sqrt(dx * dx + dy * dy);
    if (!legLength) continue;

    const px = (point[0] - from[0]) * lonScale;
    const py = point[1] - from[1];
    // Where on the leg the point falls, nought at its start and one at its
    // end, held between the two so that a point past the end of the line is
    // put at the end of it rather than beyond it.
    const t = Math.min(1, Math.max(0, (px * dx + py * dy) / legLength ** 2));
    const off = Math.sqrt((px - t * dx) ** 2 + (py - t * dy) ** 2);
    if (off < best.off) best = { along: travelled + t * legLength, off };
    travelled += legLength;
  }

  return best;
};

/**
 * The line drawn on the ground, as a KML route file carries it.
 *
 * Every one of the bus operator's files holds a single `LineString` beside its
 * stop placemarks — the shape the bus actually traces, kerb by kerb, which is
 * not the run of its stops joined up: a line that goes round a block between
 * two stops looks, drawn straight, like it goes through the buildings.
 */
export const parseKmlPath = (xml: string): number[][] => {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('LineString > coordinates')
    .toArray()
    .flatMap((el) =>
      $(el)
        .text()
        .trim()
        .split(/\s+/)
        .flatMap((point) => {
          // Longitude, latitude, and an altitude every one of these files
          // writes as nought.
          const [lon, lat] = point.split(',').map(Number);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
          return [[round5(lon), round5(lat)]];
        }),
    );
};

/** Anything with coordinates in it, which is what a map file is. */
interface GeoJsonNode {
  type?: string;
  geometry?: GeoJsonNode;
  geometries?: GeoJsonNode[];
  features?: { geometry?: GeoJsonNode }[];
  coordinates?: unknown;
}

const asLine = (coordinates: unknown): number[][] =>
  Array.isArray(coordinates)
    ? coordinates.flatMap((point) => {
        if (!Array.isArray(point)) return [];
        const [lon, lat] = point.map(Number);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
        return [[round5(lon), round5(lat)]];
      })
    : [];

/**
 * Every line a GeoJSON document draws.
 *
 * Written for what a map widget actually serves rather than for the format:
 * a collection, a bare geometry or a single feature all turn up, and the ones
 * that are not lines — a marker's `Point`, an area's `Polygon` — are not what
 * a route is, so they are left where they are.
 */
export const parseGeoJsonPaths = (document: unknown): number[][][] => {
  const node = document as GeoJsonNode;
  if (!node || typeof node !== 'object') return [];

  if (node.type === 'LineString') {
    const line = asLine(node.coordinates);
    return line.length ? [line] : [];
  }
  if (node.type === 'MultiLineString' && Array.isArray(node.coordinates)) {
    return node.coordinates.map(asLine).filter((line) => line.length);
  }
  return [
    ...(node.features ?? []).flatMap((feature) =>
      parseGeoJsonPaths(feature?.geometry),
    ),
    ...(node.geometries ?? []).flatMap((geometry) =>
      parseGeoJsonPaths(geometry),
    ),
    ...(node.geometry ? parseGeoJsonPaths(node.geometry) : []),
  ];
};
