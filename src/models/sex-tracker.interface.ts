import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthResult {
  @ApiProperty()
  user;
}

export class AuthBody {
  username: string;
  password: string;
}
