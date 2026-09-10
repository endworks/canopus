/**
 * Which bus on the board is the one being waited for.
 *
 * This is the same arithmetic the app does on its own readings, and it is here
 * because from the moment a follow is registered this service is the one doing
 * the reading. The client's copy becomes the fallback for a reader whose
 * registration never landed. Two implementations of one rule is the risk in
 * that arrangement, so this file is written to be read beside
 * `LiveDepartures.swift` and says so.
 *
 * Nothing in the feed identifies a vehicle. What there is is a list of waits
 * for a line, and one fact that makes them trackable: a wait is published as a
 * duration, but what it names is an *instant*, and the instant a given bus is
 * expected barely moves between two readings a quarter of a minute apart. So a
 * bus is followed by the moment it is due rather than by its place in the
 * list: the row nearest the instant last agreed on is the same bus, and a
 * board with nothing near that instant is a board this bus has left.
 *
 * Which is the whole of why place will not do. The operator publishes two of
 * each line, and a reader may well be waiting for the second — the first is
 * pulling out as they reach the pole. Follow the top of the list and their
 * countdown silently becomes the other bus, and then ends when a bus they were
 * never waiting for departs. Follow the instant and the second one stays the
 * second one, becomes the first when the one ahead of it goes, and is still
 * the same bus throughout.
 */

/** One row of a stop's board, as the transit service publishes it. */
export interface Departure {
  line: string;
  destination: string;
  /** The operator's own words: `4 min.`, `En parada`, `Sin estimación`. */
  time: string;
}

/** What a reading says about the followed bus and the one behind it. */
export interface Reading {
  arrival: Date;
  words: string;
  next?: Date;
  nextWords?: string;
}

/**
 * How many minutes a departure is away, from the operator's own words.
 *
 * The first run of digits and nothing cleverer, capped at an hour and a half,
 * which is the far end of a timetable. A string with no number in it — a bus
 * standing at the stop, an estimate the operator would not make — has no
 * countdown to offer, and nought is not the answer to that: nought is a bus
 * that is here, and this cannot tell the difference.
 */
export const minutesUntilDeparture = (time: string): number | null => {
  const digits = /^\d+/.exec(time.trim())?.[0];
  if (!digits) return null;
  const minutes = Number(digits);
  return minutes >= 0 && minutes <= 90 ? minutes : null;
};

/** Every departure on the board that is this line going to this place. */
export const matching = (
  board: Departure[],
  line: string,
  destination: string,
): Departure[] =>
  board.filter((row) => row.line === line && row.destination === destination);

/** The operator's words as an instant. No number in them is a bus that is here. */
export const instant = (words: string, now: Date): Date =>
  new Date(now.getTime() + (minutesUntilDeparture(words) ?? 0) * 60_000);

/**
 * How far the instant a bus is due may move before it is a different bus.
 *
 * Two minutes between readings taken a quarter of a minute apart: the width of
 * the drift these estimates actually have. Spent in both directions, because
 * an estimate that improves is as ordinary as one that slips, and because the
 * board holds other buses of the same line on either side of this one. But a
 * bus can lose time while nobody is reading — a device that went quiet, a
 * service that restarted — and it cannot lose it faster than the clock runs,
 * so the slack grows with the gap at half that rate.
 */
export const slackFor = (since: number): number => Math.max(120_000, since / 2);

/**
 * The followed bus in this board, or null if it is no longer on it.
 *
 * Null means gone, and gone is said out loud rather than left to a countdown
 * that has quietly run out: those are different facts, and only one of them is
 * worth taking a Lock Screen down for.
 */
export const identify = (
  board: Departure[],
  follow: { line: string; destination: string; anchor: Date; taken: Date },
  now: Date,
): Reading | null => {
  const matches = matching(board, follow.line, follow.destination);
  const slack = slackFor(now.getTime() - follow.taken.getTime());
  const anchor = follow.anchor.getTime();

  // The row due nearest the instant last agreed on, and only where that is
  // near enough to be the same bus. Not the soonest row: on a line the
  // operator publishes twice, the soonest row is the bus in front of the one
  // this reader is waiting for.
  let tracked = -1;
  let nearest = Infinity;
  matches.forEach((row, index) => {
    const gap = Math.abs(instant(row.time, now).getTime() - anchor);
    if (gap <= slack && gap < nearest) {
      tracked = index;
      nearest = gap;
    }
  });
  if (tracked < 0) return null;

  // What is behind it is the row behind *it*, not the second on the board:
  // somebody watching the second bus is told about the third.
  const behind = matches[tracked + 1];
  return {
    arrival: instant(matches[tracked].time, now),
    words: matches[tracked].time,
    next: behind ? instant(behind.time, now) : undefined,
    nextWords: behind?.time,
  };
};

/**
 * Whether this reading is the bus arriving.
 *
 * Two ways the operator says it and both mean the wait is over: words with no
 * number in them — `En parada`, a bus standing at the pole — and a countdown
 * that has reached nought. Said in terms of the words rather than in Spanish,
 * so a change of wording at the operator's end cannot quietly stop this
 * working.
 *
 * It is the end of a follow, not a stage of one. What somebody following a bus
 * asked for was to be told when it gets there; once it has, every further push
 * is about a bus they are on.
 */
export const hasArrived = (words: string): boolean =>
  (minutesUntilDeparture(words) ?? 0) === 0;

/**
 * What a countdown to this instant reads as, in the minutes the board speaks
 * in: three and a quarter minutes left is a bus four minutes away.
 */
export const shownMinutes = (arrival: Date, now: Date): number =>
  Math.max(0, Math.ceil((arrival.getTime() - now.getTime()) / 60_000));

/**
 * Whether the device is already showing what this reading says.
 *
 * Compared as the reader reads it. A phone counting down to 3:15 is showing
 * "4 minutes", and a board that still says `4 min.` has not contradicted it —
 * pushing that would re-anchor a countdown the phone is ticking perfectly well
 * and spend a push saying nothing. What counts as a contradiction: a different
 * number of minutes, the words changing to or from the ones that carry no
 * number at all, and the one behind it changing, which the device also prints.
 */
export const agrees = (
  follow: { anchor: Date; words: string; nextWords?: string },
  reading: Reading,
  now: Date,
): boolean => {
  if (follow.nextWords !== reading.nextWords) return false;
  const minutes = minutesUntilDeparture(reading.words);
  if (minutes === null) return follow.words === reading.words;
  return shownMinutes(follow.anchor, now) === minutes;
};
