export interface CinemaPayload {
  location?: string;
}

export interface MoviePayload {
  location?: string;
}

export interface UpdatePayload {
  location?: string;
}

export interface UpdateReport {
  /** Cities whose cinemas were refreshed. */
  location: string;
  /** Sites that failed to list their cinemas at all. */
  failedSources: string[];
  /** Venues the sites listed, before duplicates were merged. */
  listed: number;
  /** Venues kept, and saved, after merging duplicates. */
  saved: number;
  /**
   * Duplicate venue documents an earlier run had saved, now removed. How many
   * venues this run merged away is `listed` minus `saved`; this is how many of
   * them were still in the database.
   */
  deleted: number;
  /** Cinemas whose billboard was refreshed. */
  warmed: number;
  /** Cinemas whose billboard failed, by id. */
  failed: string[];
  /** Films on the refreshed billboards. */
  films: number;
}

export interface BaseCinema {
  name: string;
  address?: string;
  location?: string;
  /** Postal code of the venue, when the listing states it. */
  postalCode?: string;
  /** Town the postal code belongs to, which may differ from `location`. */
  town?: string;
  website?: string;
  source?: string;
}

export interface CinemaData {
  [id: string]: BaseCinema;
}

export interface Cinema extends BaseCinema {
  id: string;
}

export interface MovieBasic {
  id: string;
  name: string;
  specialEdition?: string;
  sessions?: Session[];
  /** Spanish age classification as printed, e.g. "No recomendado para menores de 12 años." */
  ageRating?: string;
  /** Same classification as a number; 0 means suitable for all audiences. */
  minimumAge?: number;
  /** Numeric id the source site uses for this film at this cinema. */
  sourceId?: string;
  /** Title in the original language, when the listing states it. */
  originalName?: string;
  /** Theatrical release date (YYYY-MM-DD), when the listing states it. */
  releaseDate?: string;
  synopsis?: string;
  duration?: number;
  durationReadable?: string;
  director?: Crew;
  genres?: string[];
  actors?: Actor[];
  poster?: string;
  trailer?: string;
  source?: string;
}

export interface Movie extends MovieBasic {
  originalName: string;
  writers: Crew[];
  theMovieDbId?: number;
  imDbId?: string;
  tagline: string | null;
  budget: number;
  revenue: number;
  year: number;
  releaseDate: string;
  originalLanguage: string;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  /**
   * Ids of the cinemas currently showing this film. Only the movie listing
   * fills it in; cinema details already knows which cinema it is.
   */
  cinemas?: string[];
}

export interface Session {
  time: string;
  screen?: string;
  date?: string;
  type?: string;
  url?: string;
  /** Numeric id reservaentradas uses for this showing. */
  id?: string;
  /** Whether seats are assigned rather than free seating. */
  numbered?: boolean;
}

export interface Crew {
  name: string;
  picture?: string;
}

export interface Actor extends Crew {
  character?: string;
}

export interface CinemaDetails extends Cinema {
  lastUpdated: string;
  movies: Movie[];
  /** Showtimes grouped by TheMovieDB film id. */
  sessions?: Record<string, Session[]>;
}

export interface CinemaDetailsBasic extends Cinema {
  lastUpdated: string;
  movies: MovieBasic[];
  sessions?: Record<string, Session[]>;
}

export interface PruneReport {
  /** False when the run was skipped rather than nothing being stale. */
  pruned: boolean;
  /** Why it was skipped, when it was. */
  reason?: string;
  /** Venues neither site lists any more. */
  cinemas: number;
  /** Films no remaining cinema is showing. */
  movies: number;
  /** Showtimes that have already happened. */
  sessions: number;
  /** Cache entries for cinemas that no longer exist. */
  caches: number;
}

export interface CacheData {
  cacheSize: string;
  caches: string[];
}
