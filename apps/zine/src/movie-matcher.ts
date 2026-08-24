import {
  TheMovieDBMovie,
  TheMovieDBSearchResult,
} from './models/themoviedb.interface';
import { sanitizeTitle, similarity } from './utils';

/**
 * Distributor and venue qualifiers the billboards append but TheMovieDB never
 * carries: "(versión extendida)", "(VOSE)", "[4K]". Dropping every bracketed
 * group is both simpler and more complete than listing the ones seen so far.
 */
const QUALIFIER = /\([^)]*\)|\[[^\]]*\]/g;

/**
 * Spanish releases often append a subtitle TheMovieDB indexes without. Dashes
 * need surrounding space so hyphenated titles ("Spider-Man") stay intact.
 */
const SUBTITLE = /(?:\s*:|\s+[-–—])\s+.*$/;

/** Below this, it is a different film however well the runtime lines up. */
export const MIN_TITLE_SIMILARITY = 0.55;

/** Detail lookups cost one HTTP call each, so probe only the best few. */
export const MAX_CANDIDATES = 3;

/** Listed durations include trailers; re-releases get restored/recut. */
const DURATION_TOLERANCE_MIN = 20;

/**
 * How much runtime agreement moves the score. Deliberately smaller than the
 * gap between a real match and a near-miss: runtime corroborates a title, it
 * never overrules one, and it never vetoes one on its own.
 */
const DURATION_WEIGHT = 0.2;

/** Progressively looser queries, tried in order until one yields candidates. */
export const searchQueries = (name: string): string[] => {
  const stripped = name.replace(QUALIFIER, ' ');
  const full = sanitizeTitle(stripped);
  const head = sanitizeTitle(stripped.replace(SUBTITLE, ''));
  return head && head !== full ? [full, head] : [full];
};

/** Best of the localized and original titles — TheMovieDB localizes unevenly. */
export const titleScore = (
  query: string,
  candidate: { title: string; original_title: string },
): number =>
  Math.max(
    similarity(query, sanitizeTitle(candidate.title)),
    similarity(query, sanitizeTitle(candidate.original_title)),
  );

const durationScore = (duration: number, runtime: number): number => {
  if (!duration || !runtime || Number.isNaN(duration)) return 0;
  return Math.abs(duration - runtime) <= DURATION_TOLERANCE_MIN
    ? DURATION_WEIGHT
    : -DURATION_WEIGHT;
};

/**
 * Search hits worth spending a detail lookup on, best title first. TheMovieDB
 * ranks search by an opaque relevance score boosted by popularity, which drifts
 * daily and cannot be sorted, so position in the response means little — rank
 * locally rather than trusting the order.
 */
export const shortlist = (
  query: string,
  results: TheMovieDBSearchResult[],
): TheMovieDBSearchResult[] =>
  results
    .map((result) => ({ result, score: titleScore(query, result) }))
    .filter((entry) => entry.score >= MIN_TITLE_SIMILARITY)
    .sort(
      (a, b) => b.score - a.score || b.result.popularity - a.result.popularity,
    )
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.result);

export interface Match {
  movie: TheMovieDBMovie;
  score: number;
}

/** Highest combined title+runtime score, or null if the shortlist is empty. */
export const pickBest = (
  query: string,
  duration: number,
  candidates: TheMovieDBMovie[],
): Match | null =>
  candidates
    .map((movie) => ({
      movie,
      score: titleScore(query, movie) + durationScore(duration, movie.runtime),
    }))
    .sort((a, b) => b.score - a.score)[0] ?? null;
