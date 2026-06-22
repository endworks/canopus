import { ApiProperty } from '@nestjs/swagger';

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

export class LineGeometry {
  @ApiProperty()
  link?: string;

  @ApiProperty()
  about?: string;

  @ApiProperty()
  title?: string;

  @ApiProperty()
  description?: string;

  @ApiProperty()
  geometry: {
    type: string;
    coordinates: string[];
  };
}

export class Line {
  @ApiProperty()
  id: string;

  @ApiProperty()
  number: string;

  @ApiProperty()
  name?: string;

  @ApiProperty()
  color?: string;

  @ApiProperty()
  stations: LineGeometry[];

  @ApiProperty()
  hidden: boolean;

  @ApiProperty()
  lastUpdated: string;
}

export class BiziStation {
  @ApiProperty()
  id: string;

  @ApiProperty()
  street: string;

  @ApiProperty({ required: false })
  state?: string | null;

  @ApiProperty({ required: false })
  bikes?: number | null;

  @ApiProperty({ required: false })
  openDocks?: number | null;

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
