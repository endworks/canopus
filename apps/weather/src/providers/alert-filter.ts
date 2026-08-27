import { AlertRegion, WeatherAlert } from '../models/weather.interface';

/** The one scheme the region atlas is drawn in, and so the one it can place. */
const EMMA = 'EMMA_ID';

/**
 * The bands a warning can be at, by either of the two names it has.
 *
 * MeteoAlarm's colour and CAP's severity are meant to be the same ladder, and
 * across the feed they are not: Spain files yellow as Moderate, Germany files
 * it as Minor. The colour is the one MeteoAlarm normalises across its members
 * and draws its maps in, so it is the one that ranks a warning here — with the
 * severity read only where an office sent no colour at all. Both spellings are
 * accepted from a caller, because both are in the response.
 *
 * Apple's warnings carry no colour, only the CAP severity, so for those the
 * two halves of this ladder collapse into one — which is the whole reason the
 * severities are in here beside the colours rather than converted to them.
 */
const BANDS: Record<string, number> = {
  green: 1,
  minor: 1,
  yellow: 2,
  moderate: 2,
  orange: 3,
  severe: 3,
  red: 4,
  extreme: 4,
};

/** What a caller may send as a safety floor, for the error that lists them. */
export const SAFETY_BANDS = Object.keys(BANDS);

/** The `EMMA_ID` codes a warning is scoped by, which are the placeable ones. */
export const emmaCodes = (alert: { regions: AlertRegion[] }): string[] =>
  alert.regions
    .filter((region) => region.type === EMMA)
    .map((region) => region.code);

/** Loosely, for matching a place name a caller typed: no case, no accents. */
export const plain = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** Where a warning sits on the ladder: its colour first, its severity after. */
export const rankAlert = (alert: WeatherAlert): number =>
  (alert.level ? BANDS[plain(alert.level)] : undefined) ??
  BANDS[plain(alert.severity)] ??
  0;

/**
 * The warnings still standing, most severe first.
 *
 * Both sources need the same two rules and neither should drift from the
 * other: a warning with no end is kept, because an absent expiry is not a
 * lapsed one, and the ladder ranks before the clock does.
 */
export const inForce = (alerts: WeatherAlert[], now: number): WeatherAlert[] =>
  alerts
    .filter((alert) => alert.expires === undefined || alert.expires > now)
    .sort((a, b) => rankAlert(b) - rankAlert(a) || a.onset - b.onset);

/** What a caller asked to be shown, out of the warnings in force. */
export interface AlertFilter {
  /** Least band worth returning, as a colour or a CAP severity. */
  safety?: string;
  /** A region name the caller typed, matched loosely against `areas`. */
  area?: string;
  /** The region codes the cell falls in; empty means it could not be placed. */
  regions?: string[];
}

/**
 * The warnings a caller asked to see, out of the ones in force.
 *
 * Every filter here narrows a list already fetched, so a caller asking only for
 * red warnings in their own valley costs the same one upstream call as a caller
 * asking for all of them.
 *
 * Lives beside the two providers rather than inside either: MeteoAlarm hands
 * back a whole country and Apple hands back one point, but `safety` and `area`
 * mean the same thing over both, and a caller should not find that the floor
 * they set is honoured by one provider and ignored by the other.
 */
export const filterAlerts = (
  alerts: WeatherAlert[],
  { safety, area, regions }: AlertFilter,
): WeatherAlert[] => {
  const floor = safety ? BANDS[plain(safety)] : undefined;
  const wanted = area ? plain(area) : undefined;
  // An empty set means the atlas could not place the cell, which is not the
  // same as placing it nowhere: the warnings stay national rather than
  // vanishing. Only a non-empty set narrows.
  const covering = regions?.length ? new Set(regions) : undefined;

  return alerts.filter((alert) => {
    if (floor !== undefined && rankAlert(alert) < floor) return false;
    if (covering && !emmaCodes(alert).some((code) => covering.has(code))) {
      return false;
    }
    if (
      wanted &&
      !alert.areas.some((name) => plain(name).includes(wanted)) &&
      !alert.regions.some((region) => plain(region.code) === wanted)
    ) {
      return false;
    }
    return true;
  });
};
