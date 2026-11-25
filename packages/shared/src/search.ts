/**
 * One search across every service: what a hit looks like, and how a query is
 * matched and scored.
 *
 * Here rather than in each service because the gateway merges their answers
 * into one list, and scores only compare when they were all made the same way.
 */

/** What a hit is, as the client draws it. Open: a client falls back on an unknown one. */
export type SearchHitType =
  | 'bus-line'
  | 'tram-line'
  | 'series'
  | 'event'
  | 'activity'
  | 'venue'
  | 'bus-stop'
  | 'tram-stop'
  | 'bizi-station';

export interface SearchHit {
  type: SearchHitType;
  /** The id the owning service answers to, in its own routes. */
  id: string;
  title: string;
  /** A second line: a stop's lines, a venue's street, an event's dates. */
  subtitle?: string;
  /** `[longitude, latitude]`, where the thing is on the map. */
  coordinates?: [number, number];
  /** Local dates, for anything that happens. */
  startDate?: string;
  endDate?: string;
  /** Which service owns it: `agenda` or `zaragoza`. */
  service: string;
  score: number;
  /** Further sessions of the same activity at the same place, folded into this hit. */
  more?: number;
  /** For a series, its current edition: the event a client opens for it. */
  eventId?: string;
}

export interface SearchPayload {
  q: string;
  /** Only these types. Absent: all a service holds. */
  types?: SearchHitType[];
  limit?: number;
  lang?: string;
}

/** How far a query may run before it is refused: a search box, not a document. */
export const SEARCH_MAX_QUERY = 80;

/**
 * Lower case, accents off, punctuation to spaces.
 *
 * "Plaza del Pilar", "plaza  del pilar" and "PLAZA DEL PILAR," are one query,
 * and "Ofrenda" finds "ofrenda". The `ñ` is folded to `n` along with the rest:
 * a reader typing "espana" on a keyboard without one should find España.
 */
export const foldText = (text: string): string =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Words too common in place and event names to say anything on their own. */
const STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'en',
  'a',
  'al',
  'the',
  'of',
  // What is left of "nº" and "n.º" once folded.
  'n',
]);

/**
 * The city's abbreviations, written out.
 *
 * Its stop and dock names abbreviate freely and not consistently — "Pza.
 * España" for Bizi, "Plaza de España" for the bus, "Av. de Goya" — and a
 * reader types the word. Expanded on both sides, so "plaza españa" finds the
 * dock and "pza españa" the stops.
 */
const ABBREVIATIONS: Record<string, string> = {
  pza: 'plaza',
  pl: 'plaza',
  plza: 'plaza',
  av: 'avenida',
  avda: 'avenida',
  avd: 'avenida',
  c: 'calle',
  cl: 'calle',
  pso: 'paseo',
  ps: 'paseo',
  ctra: 'carretera',
  cno: 'camino',
  pte: 'puente',
  sta: 'santa',
  sto: 'santo',
  gral: 'general',
  dr: 'doctor',
  urb: 'urbanizacion',
  ptda: 'partida',
};

/** Folded, split, and each abbreviation written out. */
export const searchWords = (text: string): string[] =>
  foldText(text)
    .split(' ')
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? word);

const isNumber = (word: string) => /^[0-9]+$/.test(word);

/**
 * The words of a query that must each be found.
 *
 * Stop words are dropped unless they are all the query has, so "de" still
 * finds something rather than nothing.
 */
export const queryTokens = (query: string): string[] => {
  const words = searchWords(query);
  const meaningful = words.filter((word) => !STOP_WORDS.has(word));
  return meaningful.length > 0 ? meaningful : words;
};

/**
 * Whether a query says enough to search on: two characters, or any number,
 * since "7" is a stop and a line.
 */
export const searchable = (query: string): boolean => {
  const folded = foldText(query);
  return folded.replace(/ /g, '').length >= 2 || isNumber(folded);
};

export interface SearchField {
  text: string | undefined;
  /** How much a match here counts: a title beats a street beats a description. */
  weight: number;
  /**
   * A field of codes — a stop's number, a line's — where a number typed is
   * on its way to the code ("72" to 720). Anywhere else a number must be
   * whole, or "1" finds everything with a 1 in it.
   */
  identifier?: boolean;
}

/** At most one letter wrong, missing, extra or swapped: Damerau's distance, capped at 1. */
const withinOne = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return (
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    );
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
};

/** Below this a slip is as likely another word as a typo. */
const FUZZY_MIN = 4;

/**
 * How one query word meets one word of a field: whole 3, start 2, one slip 1.
 *
 * A slip is allowed in a word of four letters or more, against the whole
 * word or against its start as far as the reader has typed ("pilr" for
 * "pilar", "navidd" for "navidad").
 */
const wordValue = (token: string, word: string, identifier: boolean) => {
  if (word === token) return 3;
  const number = isNumber(token);
  if (word.startsWith(token)) return number && !identifier ? 0 : 2;
  if (number || token.length < FUZZY_MIN) return 0;
  if (withinOne(token, word)) return 1;
  if (
    word.length > token.length &&
    withinOne(token, word.slice(0, token.length))
  )
    return 1;
  return 0;
};

/** A name's meaningful words in order: what a phrase is compared on. */
const phraseOf = (words: string[]) =>
  words.filter((word) => !STOP_WORDS.has(word)).join(' ');

/**
 * How well these fields answer the query, or 0 when they do not.
 *
 * Every word of the query has to meet some word in some field — whole, as
 * the start of it, or with one slip — because that is what a search box
 * means while it is being typed. A word that only appears inside another
 * word ("lar" in "pilar") does not count.
 *
 * Each word scores by its best field. On top of that, the field whose
 * meaningful words are the query's, or begin with them, wins outright:
 * "plaza españa" is the stop "Plaza de España" before it is every event that
 * mentions the square.
 */
export const matchScore = (query: string, fields: SearchField[]): number => {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;
  const prepared = fields
    .filter((field) => field.text)
    .map((field) => {
      const words = searchWords(field.text);
      return {
        words,
        phrase: phraseOf(words),
        weight: field.weight,
        identifier: field.identifier ?? false,
      };
    });

  let score = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of prepared) {
      for (const word of field.words) {
        best = Math.max(
          best,
          wordValue(token, word, field.identifier) * field.weight,
        );
      }
    }
    if (best === 0) return 0;
    score += best;
  }

  const phrase = tokens.join(' ');
  for (const field of prepared) {
    if (field.phrase === phrase) score += 10 * field.weight;
    else if (field.phrase.startsWith(phrase)) score += 5 * field.weight;
  }
  return score;
};

/**
 * When two hits score the same, which comes first: the way to get somewhere
 * before what is on there, a line before its stops, the bus before the tram
 * before Bizi — the order a reader typing a bare number means them in.
 */
export const TYPE_ORDER: SearchHitType[] = [
  'bus-line',
  'tram-line',
  'bus-stop',
  'tram-stop',
  'bizi-station',
  'series',
  'event',
  'activity',
  'venue',
];

const typeRank = (type: SearchHitType) => {
  const rank = TYPE_ORDER.indexOf(type);
  return rank < 0 ? TYPE_ORDER.length : rank;
};

/**
 * The best hits first. Ties go by type, then the soonest date, then title and
 * id, so the order is total and a page never shows a hit the last one did.
 */
export const compareHits = (a: SearchHit, b: SearchHit): number =>
  b.score - a.score ||
  typeRank(a.type) - typeRank(b.type) ||
  (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') ||
  a.title.localeCompare(b.title, 'es') ||
  a.id.localeCompare(b.id);

export const rankHits = (hits: SearchHit[], limit: number): SearchHit[] =>
  hits
    .filter((hit) => hit.score > 0)
    .sort(compareHits)
    .slice(0, limit);
