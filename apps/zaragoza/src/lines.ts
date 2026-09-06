import { LineResponse, LinesResponse } from './models/line.interface';
import { ServiceLineBase } from './schemas/line.schema';

/**
 * A stored line, as a reader gets it.
 *
 * `withdrawn` is how the two halves of `hidden` recover on their own terms; it
 * is bookkeeping, so it stays out of the response.
 *
 * The drawn shape is asked for rather than assumed. It is by far the largest
 * thing a line carries — a couple of hundred coordinate pairs per leg against
 * a couple of dozen stop ids — and the listing of every line is fetched by
 * every reader at startup, where fifty of those shapes would be several
 * hundred kilobytes nobody has asked to see. One line at a time, it is a few.
 */
export const toLineResponse = (
  {
    _id,
    withdrawn,
    path,
    pathReturn,
    ...line
  }: ServiceLineBase & { _id?: unknown },
  { withPath = false }: { withPath?: boolean } = {},
): LineResponse => ({
  ...line,
  ...(withPath ? { path: path ?? [], pathReturn: pathReturn ?? [] } : {}),
  // Out of listings either because the source withdrew the line or because
  // there is no route to draw for it.
  hidden: !!withdrawn || !line.stations?.length,
});

/** Every line, keyed by id, in the order the comparison puts them. */
export const toLinesResponse = (
  lines: ServiceLineBase[],
  compare: (a: string, b: string) => number,
): LinesResponse =>
  Object.fromEntries(
    [...lines]
      .sort((a, b) => compare(a.id, b.id))
      .map((line) => [line.id, toLineResponse(line)]),
  );
