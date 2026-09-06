import { StationBase } from './models/common.interface';

/**
 * The tram network's one line.
 *
 * Written down because there is nothing to read it from: the operator
 * publishes no route file and the city's stop dataset says which stops exist,
 * not which line they belong to or in what order. Everything else about the
 * line — its stops, their order, the shape it traces and its name — is worked
 * out from those stops below rather than typed here, so the one thing that can
 * go stale is the id, and it will not: the network has run a single line since
 * 2011 and a second one is a new entry here, not an edit to this one.
 */
export const TRAM_LINE_ID = '1';

/** Five decimals, about a metre — the same precision the bus routes carry. */
const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;

/**
 * A stop's point, or null when the record carries nothing that is one.
 *
 * Trimmed and checked for having anything in it before it is a number, because
 * `Number('')` is nought and a stop stored with two empty strings for a point
 * would otherwise be put in the Gulf of Guinea and dragged the line with it.
 */
const pointOf = (station: StationBase): [number, number] | null => {
  const [lon, lat] = (station.coordinates ?? []).map((part) =>
    `${part}`.trim() ? Number(part) : NaN,
  );
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
};

/**
 * A physical stop: the pair of platforms that face each other across the
 * track, and where the two of them stand.
 *
 * The city gives each platform its own record and its own id, the last digit
 * of which says which platform it is — the same convention the arrivals
 * lookup has always relied on to ask both platforms of a stop for their board.
 * So `Plaza España` is stored twice, as (say) `1121` and `1122`, and a line
 * that listed both would run its length twice.
 */
export interface TramStop {
  /** The id without its platform digit: what the two platforms share. */
  key: string;
  /** The platform ids at this stop, in ascending order. */
  platforms: string[];
  street: string;
  /** Where the stop is: the platforms averaged, which are metres apart. */
  point: [number, number];
}

/** The id without its platform digit, which is what a stop is known by. */
export const stopKey = (id: string): string => id.slice(0, -1);

/**
 * The stops of a line, from the platform records stored for them.
 *
 * A station whose point cannot be read is left out: it cannot be put in order
 * along the line and it cannot be drawn, and a stop in the wrong place on a
 * route is worse than one that is missing from it.
 */
export const stopsOf = (stations: StationBase[]): TramStop[] => {
  const stops = new Map<
    string,
    { platforms: string[]; streets: string[]; points: [number, number][] }
  >();

  [...stations]
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
    .forEach((station) => {
      const point = pointOf(station);
      if (!point) return;
      const key = stopKey(station.id);
      const stop = stops.get(key) ?? { platforms: [], streets: [], points: [] };
      stop.platforms.push(station.id);
      if (station.street) stop.streets.push(station.street);
      stop.points.push(point);
      stops.set(key, stop);
    });

  return [...stops].map(([key, stop]) => ({
    key,
    platforms: stop.platforms,
    street: stop.streets[0] ?? key,
    point: [
      round5(
        stop.points.reduce((sum, [lon]) => sum + lon, 0) / stop.points.length,
      ),
      round5(
        stop.points.reduce((sum, [, lat]) => sum + lat, 0) / stop.points.length,
      ),
    ],
  }));
};

// Longitude degrees are shorter than latitude ones, by the cosine of the
// latitude. At Zaragoza's it is about 0.75, which is more than enough to put
// two stops in the wrong order if it is ignored.
const lonScale = Math.cos((41.65 * Math.PI) / 180);

const distance = (a: [number, number], b: [number, number]): number => {
  const dx = (a[0] - b[0]) * lonScale;
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * The stops in the order the line runs them.
 *
 * There is no published order to read, so it is recovered from where the stops
 * are: start at a terminus — the stop furthest from the middle of them all —
 * and walk to the nearest stop not yet visited, over and over. On stops strung
 * along a corridor half a kilometre apart, which is what a tram line is, the
 * nearest unvisited stop is always the next one; the walk only goes wrong on a
 * network of stops that is not a line, and this one is a line.
 *
 * The result is turned to run north to south, so that the outbound leg is the
 * same leg on every run rather than whichever end the arithmetic reached
 * first. Which of the two platforms at a stop actually serves which direction
 * is in no dataset, so it is not claimed: the legs are the line's two ends,
 * and each stop's platforms are handed out in the order the city numbers them.
 */
export const orderAlongLine = (stops: TramStop[]): TramStop[] => {
  if (stops.length < 3) return [...stops];

  const centre: [number, number] = [
    stops.reduce((sum, stop) => sum + stop.point[0], 0) / stops.length,
    stops.reduce((sum, stop) => sum + stop.point[1], 0) / stops.length,
  ];

  // The furthest stop from the middle of a line is one of its two ends.
  const start = stops.reduce((furthest, stop) =>
    distance(stop.point, centre) > distance(furthest.point, centre)
      ? stop
      : furthest,
  );

  const remaining = new Set(stops.filter((stop) => stop !== start));
  const ordered = [start];
  let current = start;
  while (remaining.size) {
    let nearest: TramStop | undefined;
    for (const stop of remaining) {
      if (
        !nearest ||
        distance(stop.point, current.point) <
          distance(nearest.point, current.point)
      ) {
        nearest = stop;
      }
    }
    remaining.delete(nearest);
    ordered.push(nearest);
    current = nearest;
  }

  // North to south: whichever end the walk began at, the line reads the one
  // way round every time it is rebuilt.
  return ordered[0].point[1] >= ordered[ordered.length - 1].point[1]
    ? ordered
    : ordered.reverse();
};

/** A line built from the stops that make it up. */
export interface BuiltTramLine {
  id: string;
  name: string;
  stations: string[];
  stationsReturn: string[];
  path: number[][];
  pathReturn: number[][];
}

/**
 * The platform each leg calls at, and the shape each leg traces.
 *
 * The two legs are the same stops walked the other way, and — unlike a bus,
 * whose return leg is a different set of stops on the other side of the road —
 * a tram's return leg calls at the same places. What differs is the platform:
 * a traveller waiting for the wrong one watches their tram go past on the far
 * side of the track. So the legs carry different ids for the same stop, which
 * is what makes the return list worth publishing at all.
 *
 * The drawn shape is the stops joined up, not a track file: the operator
 * publishes no geometry for the line, and a tram runs a reservation between
 * its stops, so the two differ by about the width of the road. Where a route
 * file exists — as it does for every bus line — the file is read instead.
 */
export const buildTramLine = (
  stations: StationBase[],
  lineId: string = TRAM_LINE_ID,
): BuiltTramLine | null => {
  const ordered = orderAlongLine(stopsOf(stations));
  if (ordered.length < 2) return null;

  const outbound = ordered.map((stop) => stop.platforms[0]);
  const back = [...ordered]
    .reverse()
    .map((stop) => stop.platforms[1] ?? stop.platforms[0]);

  const pointFor = (id: string): number[][] => {
    const point = ordered.find((stop) => stop.platforms.includes(id))?.point;
    return point ? [point] : [];
  };

  return {
    id: lineId,
    // What the line is, said the way every other line here says it: the two
    // places it runs between. Read off its own ends rather than typed, so a
    // line extended to a new terminus renames itself.
    name: `${ordered[0].street} - ${ordered[ordered.length - 1].street}`,
    stations: outbound,
    stationsReturn: back,
    path: outbound.flatMap(pointFor),
    pathReturn: back.flatMap(pointFor),
  };
};
