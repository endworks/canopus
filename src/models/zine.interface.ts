import { ApiProperty } from '@nestjs/swagger';

export class Session {
  @ApiProperty()
  date: string;

  @ApiProperty()
  time: string;

  @ApiProperty()
  room: string;

  @ApiProperty()
  type?: string;

  @ApiProperty()
  url?: string;
}

export class Crew {
  @ApiProperty()
  name: string;

  @ApiProperty()
  picture?: string;
}

export class Actor extends Crew {
  @ApiProperty()
  character?: string;
}

export class MovieBasic {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  specialEdition: string;

  @ApiProperty({
    type: [Session],
  })
  sessions: Session[];

  @ApiProperty()
  synopsis?: string;

  @ApiProperty()
  duration?: number;

  @ApiProperty()
  durationReadable?: string;

  @ApiProperty({
    type: Crew,
  })
  director?: Crew;

  @ApiProperty()
  genres?: string[];

  @ApiProperty({
    type: [Actor],
  })
  actors?: Actor[];

  @ApiProperty()
  poster?: string;

  @ApiProperty()
  trailer?: string;

  @ApiProperty()
  source?: string;
}

export class Movie extends MovieBasic {
  @ApiProperty()
  originalName?: string;

  @ApiProperty({
    type: [Crew],
  })
  writers?: Crew[];

  @ApiProperty()
  theMovieDbId?: string;

  @ApiProperty()
  imDbId?: string;

  @ApiProperty()
  tagline?: string | null;

  @ApiProperty()
  budget?: number;

  @ApiProperty()
  year?: number;

  @ApiProperty()
  releaseDate?: string;

  @ApiProperty()
  originalLanguage?: string;

  @ApiProperty()
  popularity?: number;

  @ApiProperty()
  voteAverage?: number;

  @ApiProperty()
  voteCount?: number;
}

export class Cinema {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  address?: string;

  @ApiProperty()
  location?: string;

  @ApiProperty()
  website?: string;

  @ApiProperty()
  source?: string;
}

export class CinemaDetailsBasic extends Cinema {
  @ApiProperty()
  lastUpdated?: string;

  @ApiProperty({
    type: [MovieBasic],
  })
  movies: MovieBasic[];
}

export class CinemaDetails extends Cinema {
  @ApiProperty()
  lastUpdated?: string;

  @ApiProperty({
    type: [Movie],
  })
  movies: Movie[];
}

export class CacheData {
  @ApiProperty()
  cacheSize: string;

  @ApiProperty()
  caches: string[];
}
