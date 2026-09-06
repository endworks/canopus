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
