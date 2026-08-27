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
   * Place names do not move, so this one is not bounded by truth. A week is
   * what bounds it instead: nothing evicts a cached entry but its expiry, and
   * a caller looping over invented names should not be able to grow the map
   * indefinitely.
   */
  geocode: 1000 * 60 * 60 * 24 * 7,
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
