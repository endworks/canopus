import { DateRule, Precision } from '../model/rules';
import { knownCode } from '../model/taxonomy';
import { addDays, fromLocal, localDate } from '../model/time';
import { Link, Text } from '../model/types';
import { inCity, OccurrenceCandidate } from '../city/normalise';

/**
 * What people write: the editorial layer (docs/agenda/content.md).
 *
 * Every document has a `key`, readable and permanent once published, which
 * the pipeline maps to a published id. References between editorial documents
 * use keys. A reference to a record from another source uses its source key:
 * `{ source: 'city.agenda', ref: '316583' }`.
 */
export const EDITORIAL_COLLECTIONS = [
  'series',
  'editions',
  'places',
  'events',
  'overrides',
] as const;

export type EditorialCollection = (typeof EDITORIAL_COLLECTIONS)[number];

export type EditorialState = 'draft' | 'ready' | 'published';

export interface Verified {
  url: string;
  /** Local date the facts were checked. */
  at: string;
  by?: string;
}

export interface SeriesInput {
  key: string;
  name: Text;
  summary?: Text;
  kinds: string[];
  links?: Link[];
  pattern: 'yearly' | 'seasonal' | 'irregular';
  usualMonths?: number[];
  rule?: DateRule;
  precision: Precision;
}

export interface EditionInput {
  key: string;
  series: string;
  title: Text;
  officialSpan: { startDate: string; endDate: string };
  status: 'announced' | 'programme-partial' | 'programme-complete' | 'over';
  dayStartsAt?: string;
  guests?: Text[];
  links?: Link[];
  linkCity?: { programmes?: string[]; portals?: string[] };
}

export interface PlaceInput {
  key: string;
  name: Text;
  kinds: string[];
  type?: 'venue' | 'area' | 'point';
  geo: [number, number];
  aliases?: string[];
  parent?: string;
  address?: { street?: string; postalCode?: string; district?: string };
  hoursText?: string;
  website?: string;
  /** Only while this edition runs: a stage, a fairground, a toilet block. */
  temporaryFor?: string;
}

/** A place written as an editorial place's key, or as another source's record. */
export type PlaceRef = string | { source: string; ref: string };

export type SessionInput =
  | string
  | {
      date: string;
      time?: string;
      end?: string;
      precision?: 'exact' | 'day' | 'approximate' | 'tbc';
      place?: PlaceRef;
    };

export interface RunInput {
  from: string;
  to: string;
  hours?: { days: number[]; opens: string; closes?: string }[];
  place?: PlaceRef;
}

export interface WindowInput {
  date: string;
  from: string;
  to: string;
  every: number;
  place?: PlaceRef;
}

export interface OfferInput {
  id: string;
  name?: Text;
  free?: true;
  price?: number;
  minPrice?: number;
  maxPrice?: number;
  conditions?: Text;
  url?: string;
  availability?: string;
}

export interface EventInput {
  key: string;
  type: 'programme' | 'activity';
  /** An edition's key, or another editorial event's key. */
  parent: string;
  title: Text;
  subtitle?: Text;
  summary?: Text;
  description?: Text;
  kinds: string[];
  places?: PlaceRef[];
  where?: Text;
  route?: { name: string; role?: 'start' | 'via' | 'end' }[];
  sessions?: SessionInput[];
  runs?: RunInput[];
  windows?: WindowInput[];
  offers?: OfferInput[];
  links?: Link[];
  image?: string;
  audience?: { kind: string; minAge?: number; maxAge?: number };
  status?: 'scheduled' | 'postponed' | 'cancelled';
  statusNote?: Text;
}

/** A correction on a record another source publishes. Survives every re-import. */
export interface OverrideInput {
  key: string;
  target: { source: string; ref: string } | { id: string };
  set: {
    title?: Text;
    kinds?: string[];
    /** An edition's or editorial event's key: attach the record there. */
    parent?: string;
    visibility?: 'listed' | 'searchable' | 'hidden';
    status?: 'scheduled' | 'postponed' | 'cancelled';
    statusNote?: Text;
    image?: string;
    offers?: OfferInput[];
  };
}

export type EditorialInput =
  SeriesInput | EditionInput | PlaceInput | EventInput | OverrideInput;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-9]):[0-5]\d$/;
const KEY = /^[a-z0-9][a-z0-9/-]{1,120}$/;

const isText = (value: unknown): value is Text =>
  !!value &&
  typeof value === 'object' &&
  (typeof (value as Text).es === 'string' ||
    typeof (value as Text).en === 'string');

/** The same box the importer keeps the city's own records to. */
const point = (value: unknown) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  inCity(value as [number, number]);

/**
 * What is wrong with a document, in words a person can act on. Empty: fine.
 *
 * Checked on every write, before anything reaches a reader. Only the shape is
 * checked here; whether a referenced key exists is checked when it is
 * published, since a programme may be written before its edition.
 */
export const validate = (
  collection: EditorialCollection,
  doc: any,
): string[] => {
  const errors: string[] = [];
  const need = (ok: boolean, message: string) => ok || errors.push(message);
  need(
    typeof doc?.key === 'string' && KEY.test(doc.key),
    '`key`: lower case letters, digits, "-" and "/"',
  );
  const codes = (field: string, values: unknown) => {
    need(
      Array.isArray(values) && values.length > 0,
      `\`${field}\`: at least one code`,
    );
    for (const code of (values as string[]) ?? []) {
      need(
        knownCode(code) !== 'other' || code === 'other',
        `\`${field}\`: unknown code "${code}"`,
      );
    }
  };

  if (collection === 'series') {
    need(isText(doc.name), '`name`: { es, en }');
    codes('kinds', doc.kinds);
    need(
      ['yearly', 'seasonal', 'irregular'].includes(doc.pattern),
      '`pattern`: yearly, seasonal or irregular',
    );
    need(
      ['day', 'weekend', 'month', 'season'].includes(doc.precision),
      '`precision`: day, weekend, month or season',
    );
    need(
      !!doc.rule || (doc.usualMonths ?? []).length > 0,
      'a `rule` or `usualMonths`',
    );
  }
  if (collection === 'editions') {
    need(typeof doc.series === 'string', '`series`: the series key');
    need(isText(doc.title), '`title`: { es, en }');
    need(
      DATE.test(doc.officialSpan?.startDate ?? '') &&
        DATE.test(doc.officialSpan?.endDate ?? ''),
      '`officialSpan`: { startDate, endDate } as YYYY-MM-DD',
    );
    need(
      !doc.officialSpan ||
        doc.officialSpan.startDate <= doc.officialSpan.endDate,
      '`officialSpan`: it ends before it starts',
    );
    need(
      ['announced', 'programme-partial', 'programme-complete', 'over'].includes(
        doc.status,
      ),
      '`status`: announced, programme-partial, programme-complete or over',
    );
  }
  if (collection === 'places') {
    need(isText(doc.name), '`name`: { es, en }');
    codes('kinds', doc.kinds);
    need(point(doc.geo), '`geo`: [longitude, latitude] inside Zaragoza');
  }
  if (collection === 'events') {
    need(
      ['programme', 'activity'].includes(doc.type),
      '`type`: programme or activity',
    );
    need(typeof doc.parent === 'string', '`parent`: an edition or event key');
    need(isText(doc.title), '`title`: { es, en }');
    codes('kinds', doc.kinds);
    need(
      doc.type === 'programme' ||
        (doc.places ?? []).length > 0 ||
        isText(doc.where) ||
        (doc.route ?? []).length > 0,
      'an activity needs `places`, `where` or `route`',
    );
    for (const s of doc.sessions ?? []) {
      if (typeof s === 'string')
        need(
          /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s),
          `\`sessions\`: "${s}" is not "YYYY-MM-DD HH:mm"`,
        );
      else
        need(
          DATE.test(s?.date ?? '') && (!s.time || TIME.test(s.time)),
          `\`sessions\`: ${JSON.stringify(s)}`,
        );
    }
    for (const r of doc.runs ?? [])
      need(
        DATE.test(r?.from ?? '') && DATE.test(r?.to ?? '') && r.from <= r.to,
        `\`runs\`: ${JSON.stringify(r)}`,
      );
    for (const w of doc.windows ?? []) {
      need(
        DATE.test(w?.date ?? '') &&
          TIME.test(w?.from ?? '') &&
          TIME.test(w?.to ?? '') &&
          w.every > 0,
        `\`windows\`: ${JSON.stringify(w)}`,
      );
    }
    for (const o of doc.offers ?? []) {
      need(typeof o?.id === 'string', '`offers`: each needs an `id`');
      need(
        o?.free === true ||
          typeof o?.price === 'number' ||
          typeof o?.minPrice === 'number' ||
          !!o?.url,
        `\`offers\`: "${o?.id}" says nothing: free, a price or a url`,
      );
    }
  }
  if (collection === 'overrides') {
    const t = doc.target ?? {};
    need(
      (typeof t.source === 'string' && typeof t.ref === 'string') ||
        typeof t.id === 'string',
      '`target`: { source, ref } or { id }',
    );
    need(!!doc.set && Object.keys(doc.set).length > 0, '`set`: what to change');
    if (doc.set?.kinds) codes('set.kinds', doc.set.kinds);
    if (doc.set?.visibility)
      need(
        ['listed', 'searchable', 'hidden'].includes(doc.set.visibility),
        '`set.visibility`',
      );
  }
  return errors;
};

const sessionKey = (
  date: string,
  time: string | undefined,
  place: string | undefined,
) => `editorial|${place ?? '-'}|${date}T${time ?? 'day'}`;

/**
 * The shorthand of content.md into occurrences.
 *
 * `sessions` are exact times, or whole days where only the day is known;
 * `runs` are open across days with hours; `windows` repeat inside a range.
 * A time before the edition's `dayStartsAt` is listed under the night before:
 * the 04:15 mass on the 12th belongs to the 11th's night.
 */
export const expandOccurrences = (
  event: Pick<EventInput, 'sessions' | 'runs' | 'windows'>,
  placeOf: (ref?: PlaceRef) => string | undefined,
  dayStartsAt = '06:00',
): (Omit<OccurrenceCandidate, 'placeRef'> & { placeId?: string })[] => {
  const out: (Omit<OccurrenceCandidate, 'placeRef'> & { placeId?: string })[] =
    [];
  for (const raw of event.sessions ?? []) {
    const s =
      typeof raw === 'string'
        ? {
            date: raw.slice(0, 10),
            time: raw.length > 10 ? raw.slice(11, 16) : undefined,
          }
        : raw;
    const precision =
      typeof raw === 'string'
        ? s.time
          ? 'exact'
          : 'day'
        : (raw.precision ?? (s.time ? 'exact' : 'day'));
    const placeId = placeOf(typeof raw === 'string' ? undefined : raw.place);
    const listedOn =
      s.time && s.time < dayStartsAt ? addDays(s.date, -1) : s.date;
    if (s.time && precision !== 'day' && precision !== 'tbc') {
      const starts = fromLocal(s.date, s.time);
      const end = typeof raw === 'string' ? undefined : raw.end;
      let ends = end ? fromLocal(s.date, end) : undefined;
      if (ends && ends <= starts) ends = fromLocal(addDays(s.date, 1), end);
      out.push({
        sourceKey: sessionKey(s.date, s.time, placeId),
        placeId,
        kind: 'session',
        starts,
        ends,
        precision: precision === 'approximate' ? 'approximate' : 'exact',
        localDate: listedOn,
        localTime: s.time,
        localEndDate: ends ? localDate(ends) : undefined,
        localEndTime: end,
      });
    } else {
      out.push({
        sourceKey: sessionKey(s.date, undefined, placeId),
        placeId,
        kind: 'session',
        starts: fromLocal(s.date),
        ends: fromLocal(addDays(s.date, 1)),
        precision: precision === 'tbc' ? 'tbc' : 'day',
        localDate: s.date,
      });
    }
  }
  for (const r of event.runs ?? []) {
    const placeId = placeOf(r.place);
    out.push({
      sourceKey: `editorial|${placeId ?? '-'}|run:${r.from}:${r.to}`,
      placeId,
      kind: r.from === r.to ? 'session' : 'run',
      starts: fromLocal(r.from),
      ends: fromLocal(addDays(r.to, 1)),
      precision: 'day',
      localDate: r.from,
      localEndDate: r.to,
      hours: r.hours,
    });
  }
  for (const w of event.windows ?? []) {
    const placeId = placeOf(w.place);
    out.push({
      sourceKey: `editorial|${placeId ?? '-'}|window:${w.date}T${w.from}`,
      placeId,
      kind: 'window',
      starts: fromLocal(w.date, w.from),
      ends: fromLocal(w.date, w.to),
      every: w.every,
      precision: 'exact',
      localDate: w.date,
      localTime: w.from,
      localEndDate: w.date,
      localEndTime: w.to,
    });
  }
  return out;
};
