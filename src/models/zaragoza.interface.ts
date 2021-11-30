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
