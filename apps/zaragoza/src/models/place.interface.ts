/**
 * The city's points, in the one shape they all share.
 *
 * Zaragoza publishes a taxi rank and a chemist on duty from the same API and
 * in nearly the same envelope: an id, a title
 * that is usually the street it stands on, and a point. What differs between
 * them is a field or two — a phone on a chemist, a status on a moving taxi —
 * and not enough to be worth a service, a schema and a controller each, the
 * way the bus and the Bizi have. Those two earn theirs by holding state the
 * city does not: arrival times gathered per stop, docks counted per station. A
 * taxi rank is where it was in 2020 and will be there tomorrow.
 */
export interface Place {
  id: string;
  /** The street, mostly. What the city writes on the pin. */
  title: string;
  latitude: number;
  longitude: number;
  /** Only where the dataset has one: a chemist, an office. */
  phone?: string;
  /**
   * Only on the live taxis, which are served on their own route.
   *
   * A taxi is `Libre` or it is not for hire. It shares this record because it
   * is the same thing on a map — a name and a point — but nothing else about
   * it is the same: it is true for thirty seconds where a rank is true for a
   * year, and a route that mixes the two teaches every caller to distrust the
   * freshness of both.
   */
  status?: string;
  /** The street, where the title is a name rather than an address. */
  address?: string;
  /**
   * When it is open, in the city's own words.
   *
   * For a chemist this is the duty shift — "Abiertas de 9:15 h. a 13:45 h. y
   * de 17:00 h. a 21:30 h." — which is the thing somebody standing outside at
   * ten at night needs, and not the same as its ordinary hours. Where a
   * pharmacy publishes both, the shift wins: the list it is on is the duty
   * list, and that is what it is being shown for.
   */
  schedule?: string;
  /**
   * The day a duty shift applies to.
   *
   * Chemists on duty turn over at a fixed hour and the city publishes one
   * day at a time. Carried so the app can say which day it is showing rather
   * than implying the answer is always today — sending somebody across the
   * city to a chemist that closed at midnight is the one failure here that
   * costs more than a wasted tap.
   */
  date?: string;
  /** Whatever else is worth a line: a duty sector, what a place is. */
  detail?: string;
  /** Where the place publishes one. */
  url?: string;
}

export type PlacesResponse = Record<string, Place>;

/** The datasets this serves, named the way the app asks for them. */
export type PlaceKind = 'taxi-rank' | 'taxi-office' | 'pharmacy';

export interface PlacesPayload {
  kind: PlaceKind;
}

export interface PlacePayload {
  kind: PlaceKind;
  id: string;
}
