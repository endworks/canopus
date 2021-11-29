import { ApiProperty } from '@nestjs/swagger';

// Bus
export class StationTime {
  @ApiProperty()
  destination: string;

  @ApiProperty()
  line: string;

  @ApiProperty()
  time: string;
}

export class Station {
  @ApiProperty()
  id: string;

  @ApiProperty()
  street: string;

  @ApiProperty()
  lines: string[];

  @ApiProperty({
    type: [StationTime],
  })
  times: StationTime[];

  @ApiProperty()
  coordinates: string[];

  @ApiProperty()
  source?: string;

  @ApiProperty()
  sourceUrl?: string;

  @ApiProperty()
  lastUpdated?: string;

  @ApiProperty()
  type?: string;
}

export class Line {
  @ApiProperty()
  id: string;

  @ApiProperty()
  lastUpdated: string;

  @ApiProperty()
  number: string;

  @ApiProperty()
  routes: string[];
}

// Cinema
export class Session {
  @ApiProperty()
  time: string;

  @ApiProperty()
  room: string;

  @ApiProperty()
  type?: string;

  @ApiProperty()
  url?: string;
}

export class Movie {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    type: [Session],
  })
  sessions: Session[];

  @ApiProperty()
  synopsis?: string;

  @ApiProperty()
  duration?: number;

  @ApiProperty()
  director?: string;

  @ApiProperty()
  genres?: string[];

  @ApiProperty()
  actors?: string[];

  @ApiProperty()
  poster?: string;

  @ApiProperty()
  trailer?: string;

  @ApiProperty()
  source?: string;
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

export class CinemaMovies extends Cinema {
  @ApiProperty({
    type: [Movie],
  })
  movies: Movie[];
}
