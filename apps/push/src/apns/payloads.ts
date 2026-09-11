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
  /**
   * The bus is at the stop.
   *
   * Told apart from `gone` because they are different sentences to somebody
   * looking at a Lock Screen: one is "here it is", the other is "you missed
   * it". Both end the follow.
   */
  arrived: boolean;
}

export const contentState = (
  reading: Reading,
  taken: Date,
  gone = false,
  arrived = false,
): ContentState => ({
  arrival: epoch(reading.arrival),
  words: reading.words,
  taken: epoch(taken),
  next: reading.next ? epoch(reading.next) : undefined,
  nextWords: reading.nextWords,
  gone,
  arrived,
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
    // A bus a minute away is the definition of the thing Apple made this
    // level for: it is worth a Focus interrupting for, and worth nothing at
    // all an hour later. Only where there is something to say out loud — an
    // ordinary update moves a number and must never make a sound.
    ...(alert ? { alert, 'interruption-level': 'time-sensitive' } : {}),
    // Where this countdown sits against the reader's other Live Activities.
    // The one whose bus is nearest is the one that should be on top.
    'relevance-score': relevance(state),
  },
});

/**
 * How much this banner matters against the reader's other ones, 0 to 100.
 *
 * The nearer the bus, the higher: a departure two minutes away outranks one
 * twenty minutes away, and an ending outranks both because it is the last
 * thing anybody needs to see about it.
 */
const relevance = (state: ContentState): number => {
  if (state.arrived || state.gone) return 100;
  const minutes = Math.max(0, (state.arrival - epoch(new Date())) / 60);
  return Math.round(Math.max(1, 99 - minutes));
};

/**
 * The end of one.
 *
 * `dismissal-date` rather than an immediate end: somebody who has just got on
 * the bus deserves a couple of minutes of the Lock Screen saying why the
 * countdown stopped, and then it should take itself away.
 */
export const endPayload = (
  state: ContentState,
  alert?: { title: string; body: string },
) => ({
  aps: {
    timestamp: epoch(new Date()),
    event: 'end',
    'content-state': state,
    'dismissal-date': epoch(new Date()) + 120,
    // The bus is here. If this carries a sound at all it is because the
    // reader never got the minute-before nudge, which makes it the last
    // chance to tell them and the most time-sensitive thing this service
    // sends.
    ...(alert ? { alert, 'interruption-level': 'time-sensitive' } : {}),
  },
});

/**
 * An ordinary notification, for a device with no activity to update.
 *
 * Time sensitive, and this is the one place in this service where that claim
 * is plainly true: it is sent about a minute before a bus reaches a pole
 * somebody is standing at, it is useless a few minutes later, and a Focus that
 * held it back until the evening would be holding back the only thing the
 * reader asked for. The app carries the entitlement that lets it be honoured.
 */
export const alertPayload = (title: string, body: string) => ({
  aps: {
    alert: { title, body },
    sound: 'default',
    'interruption-level': 'time-sensitive',
    'relevance-score': 100,
  },
});
