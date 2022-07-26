import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { SexTrackerService } from 'src/services/sex-tracker.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sexTrackerService: SexTrackerService) {
    super();
  }

  async validate(username: string, password: string): Promise<any> {
    const user = await this.sexTrackerService.validateUser(username, password);

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
