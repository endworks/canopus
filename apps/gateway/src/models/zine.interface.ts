export class Session {
  time: string;
  screen?: string;
  date?: string;
  type?: string;
  url?: string;
}

export class Crew {
  name: string;
  picture?: string;
}

export class Actor extends Crew {
  character?: string;
}

export class Cinema {
  id: string;
  name: string;
  address?: string;
  location?: string;
  website?: string;
  source?: string;
}

export class MovieBasic {
  id: string;
  name: string;
  specialEdition?: string;
  sessions?: Session[];
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

export class Movie extends MovieBasic {
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
}

export class CinemaDetails extends Cinema {
  lastUpdated: string;
  movies: Movie[];
}

export class CinemaDetailsBasic extends Cinema {
  lastUpdated: string;
  movies: MovieBasic[];
  sessions?: Record<string, Session[]>;
}

export class CacheData {
  cacheSize: string;
  caches: string[];
}
