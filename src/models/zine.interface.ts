import { ApiProperty } from '@nestjs/swagger';

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

export class CinemaDetails extends Cinema {
  @ApiProperty()
  lastUpdated?: string;

  @ApiProperty({
    type: [Movie],
  })
  movies: Movie[];
}
