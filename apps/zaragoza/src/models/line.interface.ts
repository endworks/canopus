/**
 * A line as it leaves this service, whichever network runs it.
 *
 * The bus and the tram answer with the same envelope so a client can draw
 * either without knowing which it asked for.
 */
export interface LineResponse {
  id: string;
  name: string;
  color?: string;
  /** Stop ids along the outbound leg, in route order. */
  stations: string[];
  /**
   * Stop ids along the return leg, in that leg's own order. Not the outbound
   * list reversed: the return leg calls at the other side of the road, or the
   * other platform, which is a different stop with a different id.
   */
  stationsReturn?: string[];
  /**
   * The shape each leg traces, `[longitude, latitude]` pairs in route order.
   *
   * Only on one line asked for by id. The listing of every line leaves them
   * out — see `toLineResponse` — so a reader that wants to draw a route asks
   * for that line.
   */
  path?: number[][];
  pathReturn?: number[][];
  /** Withdrawn, or with no route to draw. Derived, never stored. */
  hidden: boolean;
  lastUpdated: string;
}

export interface LinesResponse {
  [id: string]: LineResponse;
}
