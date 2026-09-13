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
  /**
   * The vehicle is coming in — nought minutes, or standing at the pole.
   *
   * A stage rather than an ending: the countdown stays up, saying so, until
   * the board stops listing it. That is the only arrival a tram ever
   * announces, since its board has no at-the-stop wording of its own.
   */
  arriving: boolean;
}

export const contentState = (
  reading: Reading,
  taken: Date,
  gone = false,
  arrived = false,
  arriving = false,
): ContentState => ({
  arrival: epoch(reading.arrival),
  words: reading.words,
  taken: epoch(taken),
  next: reading.next ? epoch(reading.next) : undefined,
  nextWords: reading.nextWords,
  gone,
  arrived,
  arriving,
});

/**
 * How long a reading's own words are worth repeating, in seconds.
 *
 * The app's `READING_FRESH_SECONDS`, and it has to stay the app's: the banner
 * asks `isStale` before it shows the operator's minute or the departure behind
 * it, and this is the number that answers. Readings go out every half a minute,
 * so a banner this far past its last one is a banner nothing is keeping.
 */
const FRESH = 150;

/**
 * An update to a running activity.
 *
 * `stale-date` is dated from when the reading was taken rather than from the
 * arrival it names. Two minutes past the arrival was a window that opened only
 * at the very end: a countdown this service stopped speaking to twenty minutes
 * out stayed un-stale for the whole of the rest of it, and the banner went on
 * showing an operator's `5 min` that nothing had moved since. The countdown
 * survives that on its own, because it counts to an instant; the words do not,
 * because they were true once.
 */
export const updatePayload = (
  state: ContentState,
  alert?: { title: string; body: string },
) => ({
  aps: {
    timestamp: epoch(new Date()),
    event: 'update',
    'content-state': state,
    'stale-date': state.taken + FRESH,
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

/** What a banner is built from, as the app's own `DepartureAttributes` spells it. */
export interface Attributes {
  stop: string;
  stopKey: string;
  stopId: string;
  kindKey: string;
  line: string;
  destination: string;
}

/**
 * A banner raised from here, on a phone that drew none of its own.
 *
 * The app asks to be followed with no activity token when it is not allowed to
 * raise one itself, and this is the other half of that: the push-to-start token
 * addresses the *kind* of activity rather than a running one, so this service
 * decides there is a countdown at all. `attributes-type` is the Swift type's
 * own name and has to stay spelled as the app spells it, because ActivityKit
 * matches on the string and a miss is silent.
 */
export const startPayload = (
  attributes: Attributes,
  state: ContentState,
  alert?: { title: string; body: string },
) => ({
  aps: {
    timestamp: epoch(new Date()),
    event: 'start',
    'attributes-type': 'DepartureAttributes',
    attributes,
    'content-state': state,
    'stale-date': state.taken + FRESH,
    'relevance-score': relevance(state),
    ...(alert ? { alert, 'interruption-level': 'time-sensitive' } : {}),
  },
});

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
    // The bus is here, or it has gone. Either is worth a sound of its own
    // whether or not the minute-before nudge already rang — they are three
    // different sentences, and `rung` is what keeps each of them to one.
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
