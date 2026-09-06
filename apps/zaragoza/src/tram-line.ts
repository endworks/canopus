import { distance, Point, projectOnPath, round5 } from './geo';
import { StationBase } from './models/common.interface';

/**
 * The tram network's one line, called what the operator calls it.
 *
 * `L1`, not `1`. The letter is how the network writes its own line — on the
 * stops, on the maps and on the front of the tram — and it is also what keeps
 * a tram line from colliding with a bus line in anything that holds both: the
 * bus network runs a line 21 and would one day run a line 1, and two different
 * lines under one id is a client showing bus alterations on a tram stop.
 *
 * Written down because there is nothing to read it from: the operator
 * publishes no route file and the city's stop dataset says which stops exist,
 * not which line they belong to or in what order. Everything else about the
 * line — its stops, their order, the shape it traces and its name — is worked
 * out from those stops below rather than typed here, so the one thing that can
 * go stale is the id, and it will not: the network has run a single line since
 * 2011 and a second one is a new entry here, not an edit to this one.
 */
export const TRAM_LINE_ID = 'L1';

/**
 * A tram line id, as this service writes one.
 *
 * The city's arrivals feed answers for a tram stop with the line as a bare
 * number, and the network's own name for that line carries the letter. Both
 * name the same line, so a bare number is given the letter here — otherwise a
 * stop's board would list arrivals on a line no line list contains, and a
 * client matching the two would match nothing.
 *
 * Anything that already carries the letter keeps it, whatever case it arrived
 * in, and anything that is not a number at all is left exactly as it was: a
 * label nobody here recognises is not improved by guessing at it.
 */
export const tramLineId = (raw: string): string => {
  const said = `${raw ?? ''}`.trim();
  const numbered = said.toUpperCase().match(/^L?0*(\d+)$/);
  return numbered ? `L${numbered[1]}` : said;
};

/**
 * A stop's point, or null when the record carries nothing that is one.
 *
 * Trimmed and checked for having anything in it before it is a number, because
 * `Number('')` is nought and a stop stored with two empty strings for a point
 * would otherwise be put in the Gulf of Guinea and dragged the line with it.
 */
const pointOf = (station: StationBase): Point | null => {
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
  point: Point;
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
    { platforms: string[]; streets: string[]; points: Point[] }
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

  const centre: Point = [
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

/**
 * How far off the drawn route a stop may sit and still be a stop on it.
 *
 * A hundred metres, in degrees of latitude. The platforms of a stop stand
 * either side of the track, so a stop is metres from the line it is on; a
 * hundred is room for a widget that drew the route down the middle of a dual
 * carriageway, and nowhere near enough to sweep in a stop of a line to come.
 */
const maxOffRoute = 100 / 111_320;

/**
 * The stops in the order the drawn route reaches them.
 *
 * Better than walking stop to stop, and for the reason the drawn shape is
 * better than the stops joined up: this is the route itself, so the order it
 * gives is the order the tram runs whatever the line does — a loop, a
 * doubling back, a stop that is nearer the next line than the previous stop.
 * The walk is what remains for the runs where nothing drew the route.
 *
 * A stop the route does not pass is left out entirely. That is the check that
 * keeps a wrong shape from producing a confident wrong line: if the route read
 * off the page is the city's ring road, no stop is within a hundred metres of
 * it and this returns nothing, and the caller falls back rather than
 * publishing a line in the wrong order.
 */
export const orderAlongPath = (
  stops: TramStop[],
  path: number[][],
): TramStop[] => {
  if (path.length < 2) return [];

  const placed = stops.flatMap((stop) => {
    const { along, off } = projectOnPath(path as Point[], stop.point);
    return off <= maxOffRoute ? [{ stop, along }] : [];
  });

  return placed.sort((a, b) => a.along - b.along).map(({ stop }) => stop);
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
 * `path` is the route as the operator's own map widget draws it, kerb by kerb.
 * Given one, it both orders the stops and is what the line is drawn with, and
 * the return leg is it reversed — a tram runs the same track both ways, which
 * is the one place a tram is simpler than a bus. Without one the stops are put
 * in order by walking between them and the line is drawn through them, which
 * for a tram in its own reservation is out by about the width of the road.
 */
export const buildTramLine = (
  stations: StationBase[],
  { path, lineId = TRAM_LINE_ID }: { path?: number[][]; lineId?: string } = {},
): BuiltTramLine | null => {
  const stops = stopsOf(stations);
  // The drawn route orders the stops, but only while it is a route these stops
  // are on: one that reaches too few of them is somebody else's shape, and the
  // walk is a better answer than a confident wrong one.
  const drawn = path?.length ? orderAlongPath(stops, path) : [];
  const routed = drawn.length >= Math.max(2, stops.length - 1);
  if (!routed && stops.length < 2) return null;

  // North to south, whichever way the drawn route happens to run, so the
  // outbound leg is the same leg every time the line is rebuilt. The stops and
  // the shape are turned together or the line lists its stops one way round
  // and draws itself the other. `orderAlongLine` turns its own.
  const southbound =
    routed && drawn[0].point[1] < drawn[drawn.length - 1].point[1];
  const ordered = routed
    ? southbound
      ? [...drawn].reverse()
      : drawn
    : orderAlongLine(stops);
  const drawnPath = routed ? (southbound ? [...path].reverse() : path) : [];
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
    // The track where it was drawn for us, and the stops joined up where it
    // was not. `routed` is the difference between the two, and it is not a
    // field on the line: what a reader does with a route is draw it, and both
    // of these are the best shape available for that.
    path: routed ? drawnPath : outbound.flatMap(pointFor),
    pathReturn: routed ? [...drawnPath].reverse() : back.flatMap(pointFor),
  };
};
