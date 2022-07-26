import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthResult {
  @ApiProperty()
  user;
}
