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

/** The colour each rung of that ladder is drawn in, by its rank. */
const COLOURS = ['', 'green', 'yellow', 'orange', 'red'];

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

/** The order a list of warnings is read in: worst first, soonest after. */
const worstFirst = (a: WeatherAlert, b: WeatherAlert): number =>
  rankAlert(b) - rankAlert(a) || a.onset - b.onset;

/**
 * The warning with its band named, whichever of the band's two names it came
 * with.
 *
 * MeteoAlarm publishes the colour and Apple publishes only the CAP severity,
 * and a client colouring a card by `level` was left drawing nothing for one of
 * them — or, worse, colouring by the severity itself, which put the same
 * orange warning on an orange card from one source and a red one from the
 * other. The ladder is already shared, so this only writes down the rung the
 * warning was on either way.
 *
 * The office's own colour always wins where it sent one; this fills a gap
 * rather than overruling anybody. Where the severity is one this ladder does
 * not know — CAP's `Unknown`, which is a real value — the band stays unnamed,
 * because a colour invented for it would be a claim nobody made.
 */
const banded = (alert: WeatherAlert): WeatherAlert => {
  if (alert.level) return alert;
  const colour = COLOURS[BANDS[plain(alert.severity)] ?? 0];
  return colour ? { ...alert, level: colour } : alert;
};

/**
 * The warnings still standing, most severe first, each on a named band.
 *
 * Both sources need the same three rules and none of them should drift from
 * the other: a warning with no end is kept, because an absent expiry is not a
 * lapsed one; the ladder ranks before the clock does; and a warning arrives
 * carrying the rung it is on whichever source it came through.
 */
export const inForce = (alerts: WeatherAlert[], now: number): WeatherAlert[] =>
  alerts
    .filter((alert) => alert.expires === undefined || alert.expires > now)
    .map(banded)
    .sort(worstFirst);

/**
 * The longest a phenomenon may stand down and still be the same episode.
 *
 * Offices issue a long spell one day at a time: AEMET's heat warnings run noon
 * to nine in the evening and start again the next noon, so the same orange
 * warning arrives three times over with fifteen hours of night between them.
 * A day is the line because a day is what those gaps are made of — a warning
 * that goes away for longer than that and comes back is a second episode, and
 * a reader is owed a second card for it.
 */
const RESUMES = 24 * 3600;

/**
 * What makes two warnings the same warning, told twice.
 *
 * The office that issued it, the phenomenon it names, and the band it is at.
 * Deliberately not the region: a warning reaching a reader twice is most often
 * one office's warning about two neighbouring zones, and the region is the
 * only thing different about the second copy.
 *
 * Nor the wording. Where AEMET warns of the same afternoon in two adjacent
 * zones, one description reads 40 °C and the other 39 °C, and a reader
 * standing on the line between them is owed one orange heat warning rather
 * than two cards they must compare word by word to find they say the same
 * thing.
 */
const story = (alert: WeatherAlert): string =>
  [plain(alert.sender), plain(alert.event), rankAlert(alert)].join('|');

/**
 * One story's copies, split into the episodes they actually describe.
 *
 * Walked in time order, and a copy joins the run in hand when it starts before
 * that run has been over for a day. Overlapping copies are the same afternoon
 * told twice — two zones, or an update that named no predecessor — and copies
 * a night apart are consecutive days of one spell. A copy that begins after a
 * clear day starts a run of its own.
 */
const episodes = (copies: WeatherAlert[]): WeatherAlert[][] => {
  const runs: WeatherAlert[][] = [];
  let end = -Infinity;

  for (const copy of [...copies].sort((a, b) => a.onset - b.onset)) {
    if (runs.length > 0 && copy.onset <= end + RESUMES) {
      runs[runs.length - 1].push(copy);
      end = Math.max(end, copy.expires ?? Infinity);
    } else {
      runs.push([copy]);
      end = copy.expires ?? Infinity;
    }
  }

  return runs;
};

/**
 * The regions of every copy, each still carrying the scheme its code is in.
 *
 * Deduplicated on both halves rather than on the code, for the same reason
 * `filterAlerts` matches on both: the codes collide across schemes.
 */
const regionsOf = (copies: WeatherAlert[]): AlertRegion[] => {
  const seen = new Map<string, AlertRegion>();
  for (const region of copies.flatMap((copy) => copy.regions)) {
    seen.set(`${region.type}|${region.code}`, region);
  }
  return [...seen.values()];
};

/** Which copy speaks for the episode: the latest word, the soonest first. */
const speaksFor = (a: WeatherAlert, b: WeatherAlert): number =>
  (b.issued ?? 0) - (a.issued ?? 0) || a.onset - b.onset;

/**
 * One warning out of the copies of it, covering the whole episode.
 *
 * The wording is the most recently issued copy's, because that is the office's
 * latest word on the phenomenon — an update that named no predecessor still
 * supersedes what it was written to replace. Where they were issued together,
 * as a bulletin covering several days is, the copy that starts soonest speaks:
 * a reader wants this afternoon's forty degrees, not Thursday's.
 *
 * The window is the whole run's, so a spell issued a day at a time reads as
 * the one spell it is rather than as three warnings that look identical in a
 * list. An open end anywhere in the run leaves the whole run open, since no
 * copy claims to know when it stops.
 *
 * The areas and the regions are unioned rather than taken from the survivor:
 * the copies covered real, different ground, and a client narrowing by `area`
 * or drawing a map should still see all of it.
 */
const told = (copies: WeatherAlert[]): WeatherAlert => {
  if (copies.length === 1) return copies[0];

  const [latest] = [...copies].sort(speaksFor);
  const merged: WeatherAlert = {
    ...latest,
    onset: Math.min(...copies.map((copy) => copy.onset)),
    areas: [...new Set(copies.flatMap((copy) => copy.areas))],
    regions: regionsOf(copies),
  };

  const open = copies.some((copy) => copy.expires === undefined);
  const ends = Math.max(...copies.map((copy) => copy.expires ?? 0));
  if (open) delete merged.expires;
  else merged.expires = ends;

  return merged;
};

/**
 * The warnings left once the ones telling the same story are folded together.
 *
 * Four things put one warning in front of a reader several times over, and not
 * one of them is a warning the reader needs twice.
 *
 * An office issues a long spell a day at a time. Three days of a heatwave are
 * three orange warnings for the same zone, and since the client draws a time
 * and not a date, they are three cards reading "until 20:59" — which is the
 * shape this looked like from the outside, and the reason a run of them comes
 * back as one warning spanning the spell.
 *
 * A cell is placed by testing its corners as well as its middle, so a point
 * near a boundary lands in two or three of the office's zones at once — and in
 * a heatwave every one of them is under the same warning that afternoon. That
 * over-inclusion is deliberate and stays: it is how a town on the far side of
 * a cell keeps the warning that covers it. This is where it stops being
 * visible.
 *
 * An office that updates a warning is supposed to name the message it
 * replaces, and where it does the replaced one never leaves the provider.
 * Where it does not, the day's revisions all arrive looking new.
 *
 * And Apple hands back the same offices' warnings scoped to the coordinate,
 * with no colour band and no wording beyond the headline, so two copies of one
 * afternoon are not merely alike but identical character for character.
 *
 * Applied to a list already narrowed to a place, and only there. Folded over a
 * whole country it would answer for a zone with a neighbouring zone's degrees,
 * which is the one direction a warning must not be wrong in.
 */
export const collapse = (alerts: WeatherAlert[]): WeatherAlert[] => {
  const stories = new Map<string, WeatherAlert[]>();
  const seen = new Set<string>();

  for (const alert of alerts) {
    // The same identifier twice is not a story told twice; it is one message
    // counted twice, and nothing about it needs merging.
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);

    const key = story(alert);
    const copies = stories.get(key);
    if (copies) copies.push(alert);
    else stories.set(key, [alert]);
  }

  return [...stories.values()]
    .flatMap((copies) => episodes(copies).map(told))
    .sort(worstFirst);
};

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
 *
 * Narrowing only. `collapse` is the caller's to apply afterwards, because only
 * the caller knows whether what is left is about one place: a list that could
 * not be narrowed to a cell is a whole country's warnings, and there each
 * zone's own warning is a real answer rather than a copy of its neighbour's.
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
