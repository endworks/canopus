export class Session {
  /**
   * Showtime.
   * @example '20:30'
   */
  time: string;

  /**
   * Screen / room, when known.
   * @example 'Sala 4'
   */
  screen?: string;

  /**
   * Date of the session (YYYY-MM-DD), when known.
   * @example '2026-06-24'
   */
  date?: string;

  /**
   * Format / version.
   * @example 'VOSE'
   */
  type?: string;

  /**
   * Booking URL, when available.
   * @example 'https://entradas.cinesa.es/...'
   */
  url?: string;
}

export class Crew {
  /**
   * Person's name.
   * @example 'Denis Villeneuve'
   */
  name: string;

  /**
   * Profile picture URL, when known.
   * @example 'https://image.tmdb.org/t/p/w185/abc.jpg'
   */
  picture?: string;
}

export class Actor extends Crew {
  /**
   * Character played.
   * @example 'Paul Atreides'
   */
  character?: string;
}

export class Cinema {
  /**
   * Cinema id.
   * @example 'aragonia'
   */
  id: string;

  /**
   * Cinema name.
   * @example 'Cinesa Aragonia'
   */
  name: string;

  /**
   * Street address, when known.
   * @example 'Av. de Juan Carlos I, 44'
   */
  address?: string;

  /**
   * City / area.
   * @example 'Zaragoza'
   */
  location?: string;

  /**
   * Website, when known.
   * @example 'https://www.cinesa.es/cines/aragonia/'
   */
  website?: string;

  /**
   * Where the data came from.
   * @example 'reservaentradas'
   */
  source?: string;
}

export class MovieBasic {
  /**
   * Movie id.
   * @example '438631'
   */
  id: string;

  /**
   * Title.
   * @example 'Dune: Parte dos'
   */
  name: string;

  /**
   * Special-edition label, when applicable.
   * @example 'IMAX'
   */
  specialEdition?: string;

  /** Showtimes for this movie. */
  sessions?: Session[];

  /**
   * Synopsis.
   * @example 'Paul Atreides se une a los Fremen...'
   */
  synopsis?: string;

  /**
   * Runtime in minutes.
   * @example 166
   */
  duration?: number;

  /**
   * Human-readable runtime.
   * @example '2h 46m'
   */
  durationReadable?: string;

  /** Director. */
  director?: Crew;

  /**
   * Genres.
   * @example ['Ciencia ficción', 'Aventura']
   */
  genres?: string[];

  /** Cast. */
  actors?: Actor[];

  /**
   * Poster URL.
   * @example 'https://image.tmdb.org/t/p/w500/abc.jpg'
   */
  poster?: string;

  /**
   * Trailer URL.
   * @example 'https://www.youtube.com/watch?v=Way9Dexny3w'
   */
  trailer?: string;

  /**
   * Where the data came from.
   * @example 'themoviedb'
   */
  source?: string;
}

export class Movie extends MovieBasic {
  /**
   * Original-language title.
   * @example 'Dune: Part Two'
   */
  originalName: string;

  /** Writers. */
  writers: Crew[];

  /**
   * TheMovieDB id, when matched.
   * @example 693134
   */
  theMovieDbId?: number;

  /**
   * IMDb id, when matched.
   * @example 'tt15239678'
   */
  imDbId?: string;

  /**
   * Tagline.
   * @example 'Long live the fighters.'
   */
  tagline: string | null;

  /**
   * Budget in USD.
   * @example 190000000
   */
  budget: number;

  /**
   * Revenue in USD.
   * @example 711000000
   */
  revenue: number;

  /**
   * Release year.
   * @example 2024
   */
  year: number;

  /**
   * Release date (YYYY-MM-DD).
   * @example '2024-02-27'
   */
  releaseDate: string;

  /**
   * Original language (ISO 639-1).
   * @example 'en'
   */
  originalLanguage: string;

  /**
   * TheMovieDB popularity score.
   * @example 512.34
   */
  popularity: number;

  /**
   * Average vote (0-10).
   * @example 8.2
   */
  voteAverage: number;

  /**
   * Number of votes.
   * @example 4521
   */
  voteCount: number;
}

export class CinemaDetails extends Cinema {
  /**
   * ISO timestamp of the last update.
   * @example '2026-06-23T12:00:00.000Z'
   */
  lastUpdated: string;

  /** Movies showing, with full details. */
  movies: Movie[];
}

export class CinemaDetailsBasic extends Cinema {
  /**
   * ISO timestamp of the last update.
   * @example '2026-06-23T12:00:00.000Z'
   */
  lastUpdated: string;

  /** Movies showing, with basic details. */
  movies: MovieBasic[];

  /** Sessions grouped by movie id, when provided. */
  sessions?: Record<string, Session[]>;
}

export class CacheData {
  /**
   * Number of cached entries.
   * @example '128'
   */
  cacheSize: string;

  /**
   * Cache keys.
   * @example ['cinemas', 'movies']
   */
  caches: string[];
}
