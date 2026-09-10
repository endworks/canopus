import { Reading } from '../services/tracking';

/**
 * What a push carries, and the one decision in it worth arguing about.
 *
 * A Live Activity's `content-state` is decoded into the app's own `ContentState`
 * by a decoder this end does not control. Swift's default strategy for a bare
 * `Date` is `.deferredToDate`, which is seconds since Apple's own reference
 * date rather than the epoch every other system means by "a timestamp" — a
 * thirty-one-year error, silently, in the one number this whole feature is
 * about.
 *
 * So the contract is written down rather than inherited: every instant on this
 * wire is **Unix epoch seconds**, and the app's `ContentState` decodes them
 * explicitly. Neither side is relying on a default it did not choose.
 */
export const epoch = (date: Date): number => Math.round(date.getTime() / 1000);

/** The state of a followed departure, as the app's own model spells it. */
export interface ContentState {
  arrival: number;
  words: string;
  taken: number;
  next?: number;
  nextWords?: string;
  gone: boolean;
}

export const contentState = (
  reading: Reading,
  taken: Date,
  gone = false,
): ContentState => ({
  arrival: epoch(reading.arrival),
  words: reading.words,
  taken: epoch(taken),
  next: reading.next ? epoch(reading.next) : undefined,
  nextWords: reading.nextWords,
  gone,
});

/**
 * An update to a running activity.
 *
 * `stale-date` is the same two minutes past the arrival the app sets for
 * itself: past it the phone dims the banner on its own, which is what keeps a
 * countdown honest when this service stops being able to speak to it.
 */
export const updatePayload = (
  state: ContentState,
  alert?: { title: string; body: string },
) => ({
  aps: {
    timestamp: epoch(new Date()),
    event: 'update',
    'content-state': state,
    'stale-date': state.arrival + 120,
    ...(alert ? { alert } : {}),
  },
});

/**
 * The end of one.
 *
 * `dismissal-date` rather than an immediate end: somebody who has just got on
 * the bus deserves a couple of minutes of the Lock Screen saying why the
 * countdown stopped, and then it should take itself away.
 */
export const endPayload = (state: ContentState) => ({
  aps: {
    timestamp: epoch(new Date()),
    event: 'end',
    'content-state': state,
    'dismissal-date': epoch(new Date()) + 120,
  },
});

/** An ordinary notification, for a device with no activity to update. */
export const alertPayload = (title: string, body: string) => ({
  aps: {
    alert: { title, body },
    sound: 'default',
  },
});
