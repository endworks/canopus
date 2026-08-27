/**
 * How precisely a place is asked about.
 *
 * One decimal is about eleven kilometres, which puts a whole city in a cell or
 * two — and the weather is the same at every bus stop in it. It is what makes
 * the cache worth having: every caller standing anywhere in town asks the same
 * question, so they share one upstream call instead of minting one each. Two
 * decimals looked more careful and would mean a kilometre-wide cell, which a
 * phone with the map following mints a new question for every minute of a bus
 * ride.
 *
 * Applied once, where a real coordinate becomes a question — and the rounded
 * value is what comes back in `location`, so a caller can see which cell it
 * was answered for.
 */
export const roundCoordinate = (value: number): number =>
  Math.round(value * 10) / 10;

/**
 * How wide a cell is, in degrees — the same tenth the rounding above works in,
 * named because the region atlas needs it.
 *
 * Kept as its own constant rather than divided into `roundCoordinate`, which
 * would round through a float: `Math.round(40.4168 / 0.1) * 0.1` is
 * 40.400000000000006, and that is not a name for a cell.
 */
export const CELL = 0.1;

/**
 * How long each kind of answer stands, matched to how often its source moves.
 *
 * cache-manager v7 TTLs are milliseconds.
 */
export const TTL = {
  /** OpenWeather refreshes a station reading at most every ten minutes. */
  current: 1000 * 60 * 10,
  /** The forecast is a model run; its steps are three hours wide. */
  forecast: 1000 * 60 * 30,
  /** Air quality is published hourly. */
  airQuality: 1000 * 60 * 60,
  /** So is the UV index, though its "now" is interpolated within the hour. */
  uv: 1000 * 60 * 30,
  /**
   * Warnings are the one thing here that is urgent by definition: a met office
   * upgrading an orange to a red is saying so now, not on the half hour.
   */
  alerts: 1000 * 60 * 5,
  /**
   * Place names do not move, so this one is not bounded by truth. A week is
   * what bounds it instead: nothing evicts a cached entry but its expiry, and
   * a caller looping over invented names should not be able to grow the map
   * indefinitely.
   */
  geocode: 1000 * 60 * 60 * 24 * 7,
  /**
   * A source's own branding, which changes on the timescale of a rebrand. Held
   * as long as a place name, and for the same reason: nothing bounds it but its
   * expiry.
   */
  attribution: 1000 * 60 * 60 * 24 * 7,
};

/**
 * The reading at which UV protection is advised.
 *
 * Three is where the WHO's own guidance turns from "no protection needed" into
 * "seek shade around midday", and the only reason `uvProtectionUntil` is worked
 * out at all.
 */
export const UV_PROTECTION = 3;

/** How far ahead the forecast looks: eight three-hour steps, so a day. */
export const FORECAST_STEPS = 8;

/**
 * An ISO instant as unix seconds, which is what the wire carries.
 *
 * Every upstream here dates things in ISO 8601 and every field of ours is in
 * seconds, so this sits between them once rather than once per provider.
 */
export const seconds = (time?: string): number | undefined => {
  if (!time) return undefined;
  const parsed = Date.parse(time);
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
};

/** The UV index now, and when it stops being worth protecting against. */
export interface UvReading {
  uv: number;
  uvProtectionUntil?: number;
}

/**
 * The rule about when protection stops mattering, written once.
 *
 * Two providers answer the UV index — whichever one the reading came from, and
 * Open-Meteo for the rest — and the two must not disagree about what "until"
 * means. What differs between them is only the shape their hours arrive in, so
 * the scan stays with each caller as a thunk and the rule lives here.
 *
 * `protectionUntil` is not called below the threshold: under it there is
 * nothing to be until, so neither provider pays to look.
 */
export const uvReading = (
  uv: number | undefined,
  protectionUntil: () => number | undefined,
): UvReading | undefined => {
  // Nought is a reading — it is night — so this asks what the value is rather
  // than whether it is truthy.
  if (typeof uv !== 'number') return undefined;
  if (uv < UV_PROTECTION) return { uv };

  const until = protectionUntil();
  return { uv, ...(until ? { uvProtectionUntil: until } : {}) };
};
