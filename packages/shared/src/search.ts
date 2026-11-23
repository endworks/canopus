/**
 * One search across every service: what a hit looks like, and how a query is
 * matched and scored.
 *
 * Here rather than in each service because the gateway merges their answers
 * into one list, and scores only compare when they were all made the same way.
 */

/** What a hit is, as the client draws it. Open: a client falls back on an unknown one. */
export type SearchHitType =
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
}

export interface SearchPayload {
  q: string;
  /** Only these types. Absent: all a service holds. */
  types?: SearchHitType[];
  limit?: number;
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
]);

/**
 * The words of a query that must each be found.
 *
 * Stop words are dropped unless they are all the query has, so "de" still
 * finds something rather than nothing.
 */
export const queryTokens = (query: string): string[] => {
  const words = foldText(query).split(' ').filter(Boolean);
  const meaningful = words.filter((word) => !STOP_WORDS.has(word));
  return meaningful.length > 0 ? meaningful : words;
};

export interface SearchField {
  text: string | undefined;
  /** How much a match here counts: a title beats a street beats a description. */
  weight: number;
}

/**
 * How well these fields answer the query, or 0 when they do not.
 *
 * Every word of the query has to start some word in some field: that is what
 * a search box means while it is being typed ("pil" is on its way to "pilar").
 * A word that only appears inside another word ("lar" in "pilar") does not
 * count, because it is almost never what was meant.
 *
 * Each word scores by its best field: a whole word beats a prefix, weighted by
 * the field. On top of that, the field that starts with the whole query, or is
 * the whole query, wins outright: "plaza del pilar" is the stop of that name
 * before it is every event that mentions the square.
 */
export const matchScore = (query: string, fields: SearchField[]): number => {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;
  const folded = fields
    .filter((field) => field.text)
    .map((field) => ({
      words: foldText(field.text).split(' '),
      whole: foldText(field.text),
      weight: field.weight,
    }));

  let score = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of folded) {
      for (const word of field.words) {
        const value = word === token ? 3 : word.startsWith(token) ? 2 : 0;
        best = Math.max(best, value * field.weight);
      }
    }
    if (best === 0) return 0;
    score += best;
  }

  const phrase = foldText(query);
  for (const field of folded) {
    if (field.whole === phrase) score += 10 * field.weight;
    else if (field.whole.startsWith(phrase)) score += 5 * field.weight;
  }
  return score;
};

/** The best hits first, ties broken by title so the order is stable. */
export const rankHits = (hits: SearchHit[], limit: number): SearchHit[] =>
  hits
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'es'))
    .slice(0, limit);
