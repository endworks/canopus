import { inZaragoza, Point, round5 } from './geo';

/**
 * The tram network's one line, called what the operator calls it.
 *
 * `L1`, not `1`. The letter is how the network writes its own line — on the
 * stops, on the maps and on the front of the tram — and it is also what keeps
 * a tram line from colliding with a bus line in anything that holds both: the
 * bus network runs a line 21 and would one day run a line 1, and two different
 * lines under one id is a client showing bus alterations on a tram stop.
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
 * One stop, as the operator's own line feed gives it.
 *
 * `name` is the stop's code — `0101`, `2502` — which is the id the city's
 * arrivals API answers for, so the operator's route and the city's boards
 * meet on it without anything having to be matched by name or by distance.
 *
 * `position` is where the stop falls along its direction, and `sibling_id`
 * points at the stop the other direction calls at instead of this one.
 */
export interface OperatorStop {
  id: number;
  name: string;
  displayName: string;
  lat: string | number;
  lng: string | number;
  position: number;
  sibling_id?: number;
}

/**
 * The line as the operator publishes it: its stops each way round, and the
 * shape each way traces. `sense 0` runs south to north and `sense 1` back.
 */
export interface OperatorLine {
  stops_0?: OperatorStop[];
  stops_1?: OperatorStop[];
  points_0?: (string | number)[][];
  points_1?: (string | number)[][];
}

/** A line built from what the operator published. */
export interface BuiltTramLine {
  id: string;
  name: string;
  stations: string[];
  stationsReturn: string[];
  path: number[][];
  pathReturn: number[][];
}

/** A stop, in the shape this service stores one. */
export interface BuiltTramStation {
  id: string;
  street: string;
  coordinates: string[];
}

export interface BuiltTramNetwork {
  line: BuiltTramLine;
  stations: BuiltTramStation[];
}

const clean = (text: string): string =>
  `${text ?? ''}`.replace(/\s+/g, ' ').trim();

/** A point from the feed, `[latitude, longitude]` there and reversed here. */
const point = (lat: unknown, lng: unknown): Point | null => {
  const [latitude, longitude] = [lat, lng].map((part) =>
    `${part ?? ''}`.trim() ? Number(part) : NaN,
  );
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const found: Point = [round5(longitude), round5(latitude)];
  return inZaragoza(found) ? found : null;
};

const pathOf = (points: (string | number)[][] | undefined): number[][] =>
  (points ?? []).flatMap((pair) => {
    if (!Array.isArray(pair)) return [];
    const found = point(pair[0], pair[1]);
    return found ? [found] : [];
  });

/**
 * What to call the place a stop stands at, given the stop the other direction
 * calls at instead.
 *
 * Usually one name: the two are the platforms either side of the same track
 * and the operator names them the same. But on seven of this line's twenty-five
 * stops they are not the same place at all — the track runs a one-way pair
 * through Parque Goya and again through Valdespartera, so northbound calls at
 * Margarita Xirgu and southbound at García Abril, a street apart and named for
 * different people.
 *
 * Where that happens the stop is called both, because both are true and either
 * one alone is wrong for half the travellers reading it. Ordered by stop code
 * so the name a place is given does not depend on which direction was read
 * first.
 */
export const combinedTitle = (stops: OperatorStop[]): string => {
  const names = [
    ...new Set(
      [...stops]
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
        .map((stop) => clean(stop.displayName))
        .filter(Boolean),
    ),
  ];
  return names.join(' / ');
};

/**
 * The line and its stops, from the operator's own feed.
 *
 * Everything here used to be worked out: the stops were paired by chopping the
 * last digit off their ids, put in order by walking from one end to the
 * nearest one not yet visited, and drawn by joining them up. All three are
 * published, so all three are read instead — and the first of them was wrong,
 * because chopping a digit pairs `2301` with nothing and leaves Los Pájaros
 * and La Ventana Indiscreta as two stops of one line rather than the two ways
 * round one place.
 *
 * Nothing is believed without being checked: a point has to land in Zaragoza,
 * a stop has to have a code, and a feed that yields fewer than two stops a
 * direction is not a line and returns nothing at all.
 */
export const parseOperatorLine = (
  feed: OperatorLine | undefined,
  lineId: string = TRAM_LINE_ID,
): BuiltTramNetwork | null => {
  const byPosition = (stops: OperatorStop[] | undefined) =>
    [...(stops ?? [])]
      .filter((stop) => stop && clean(stop.name))
      .sort((a, b) => a.position - b.position);

  const out = byPosition(feed?.stops_0);
  const back = byPosition(feed?.stops_1);
  if (out.length < 2 || back.length < 2) return null;

  // Both directions in one place, so a stop can be found by the id the other
  // direction names it by.
  const byId = new Map(
    [...out, ...back].map((stop) => [stop.id, stop] as const),
  );

  const stations = [...out, ...back].flatMap((stop) => {
    const where = point(stop.lat, stop.lng);
    if (!where) return [];
    const sibling = byId.get(stop.sibling_id);
    return [
      {
        id: clean(stop.name),
        street: combinedTitle(sibling ? [stop, sibling] : [stop]),
        coordinates: where.map((part) => `${part}`),
      },
    ];
  });

  const titles = new Map(
    stations.map((station) => [station.id, station.street]),
  );
  const terminus = (stop: OperatorStop) =>
    titles.get(clean(stop.name)) ?? clean(stop.displayName);

  return {
    line: {
      id: lineId,
      // The two places it runs between, as the outbound leg reaches them.
      name: `${terminus(out[0])} - ${terminus(out[out.length - 1])}`,
      stations: out.map((stop) => clean(stop.name)),
      stationsReturn: back.map((stop) => clean(stop.name)),
      path: pathOf(feed?.points_0),
      pathReturn: pathOf(feed?.points_1),
    },
    stations,
  };
};
