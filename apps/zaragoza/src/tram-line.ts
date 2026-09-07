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
 * The id a stop is known by here, from the code the operator writes.
 *
 * The operator pads its codes to four digits — `0101` — and the city's board
 * does not: the board for that stop answers at `101`. Same stop, two
 * spellings, and this is the one everything here uses, so a stored stop's id
 * is the id its board is asked for by and nothing has to translate between
 * them at read time.
 */
export const stopCode = (code: string): string => {
  const said = clean(code);
  return said.replace(/^0+/, '') || said;
};

/**
 * The place a stop's code names, without the digit that says which way the
 * tram is going through it.
 *
 * All fifty of this line's codes are four digits ending in a 1 or a 2, and the
 * operator uses that last digit for nothing else, so a nought in its place is
 * a code no stop has and every place can be stored under.
 */
const placeCode = (code: string): string => clean(code).slice(0, -1);

/**
 * The boards a stop is read from.
 *
 * A place both directions call at is stored once, under its pair's shared code
 * with a nought where the direction digit goes, and it is read from both of
 * them: one board holds what is due one way and the other what is due back,
 * and somebody standing between the two platforms wants both.
 *
 * A place only one direction calls at is stored under its own code and read
 * from its own board alone. Asking for the other would be asking the city for
 * a stop that does not exist — which is what every one-way stop here used to
 * do, and why half of them never showed a time.
 */
export const boardsOf = (id: string): string[] => {
  const said = clean(id);
  return said.endsWith('0')
    ? ['1', '2'].map((way) => stopCode(placeCode(said) + way))
    : [said];
};

/** The point between the points there are, which for one of them is it. */
const between = (points: Point[]): Point | null => {
  const found = points.filter(Boolean);
  if (!found.length) return null;
  const mean = (index: 0 | 1) =>
    round5(found.reduce((sum, at) => sum + at[index], 0) / found.length);
  return [mean(0), mean(1)];
};

/**
 * The line and its stops, from the operator's own feed.
 *
 * The operator publishes its stops one per direction — fifty of them for a
 * line of twenty-five places — and pairs the two by `sibling_id`. Eighteen of
 * those pairs are the two platforms of one place: the operator gives both the
 * same name because they are the same name, a few metres apart across the
 * track, and a traveller standing at one can catch either. Those are stored
 * once, at the point between the two platforms, and read from both boards.
 *
 * The other seven are not one place at all. The track runs a one-way pair
 * through Parque Goya and again through Valdespartera, so the two directions
 * call at different stops on different streets — northbound at Margarita
 * Xirgu and southbound at García Abril, at Clara Campoamor and Pablo Neruda,
 * at Los Pájaros and La Ventana Indiscreta. Those stay two, each under its own
 * code, each named its own name and drawn where it actually is: a traveller at
 * one of them cannot catch what calls at the other, and a single pin between
 * the two would be a pin on neither.
 *
 * The name is what decides, because the name is what the operator uses to say
 * so. The codes cannot: five of the seven split pairs share a place code and
 * are still two streets apart.
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

  /**
   * The place a stop stands at: the pair, where the two directions call at the
   * same one, and the stop alone where they do not.
   *
   * Which it is turns on the name and the place code together. The name is the
   * operator saying whether these are one place; the code agreeing is what
   * makes a shared id for it exist at all, and a pair that somehow disagreed
   * would be two stops rather than one under an id neither board answers for.
   */
  const placeOf = (stop: OperatorStop) => {
    const sibling = byId.get(stop.sibling_id);
    const together =
      !!sibling &&
      clean(sibling.displayName) === clean(stop.displayName) &&
      placeCode(sibling.name) === placeCode(stop.name);

    const here = point(stop.lat, stop.lng);
    const facing = sibling ? point(sibling.lat, sibling.lng) : null;
    return {
      id: together ? stopCode(placeCode(stop.name) + '0') : stopCode(stop.name),
      street: clean(stop.displayName),
      // A pair stands between its platforms; a stop on its own stands where
      // it is. Either can come to nothing, and a place with no point is still
      // a place the tram calls at — see below.
      at: together ? between([here, facing]) : here,
    };
  };

  const titles = new Map<string, string>();
  const places = new Map<string, BuiltTramStation>();
  const idsOf = (stops: OperatorStop[]) =>
    stops.map((stop) => {
      const place = placeOf(stop);
      if (!titles.has(place.id)) titles.set(place.id, place.street);
      // The first direction read writes the place; the second finds it there.
      // A stop whose point cannot be read is left out of the stops without
      // being left off the route: it is still one the tram calls at, and
      // dropping it from the line would be the worse lie of the two.
      if (place.at && !places.has(place.id)) {
        places.set(place.id, {
          id: place.id,
          street: place.street,
          coordinates: place.at.map((part) => `${part}`),
        });
      }
      return place.id;
    });

  const stations = idsOf(out);
  const stationsReturn = idsOf(back);

  const terminus = (id: string) => titles.get(id) ?? id;

  return {
    line: {
      id: lineId,
      // The two places it runs between, as the outbound leg reaches them.
      name: `${terminus(stations[0])} - ${terminus(stations[stations.length - 1])}`,
      stations,
      stationsReturn,
      path: pathOf(feed?.points_0),
      pathReturn: pathOf(feed?.points_1),
    },
    stations: [...places.values()],
  };
};
