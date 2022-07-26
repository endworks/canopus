import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Response } from 'express';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class SexTrackerService {
  constructor(
    @Inject('SEX_TRACKER_SERVICE')
    private readonly client: ClientProxy,
  ) {}

  public validateUser(username: string, password: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('validateUser', { username, password }),
    ).then((response) => response);
  }

  public login(res: Response, user: any): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('login', { user })).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }

  public validateToken(res: Response, jwt: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('validateToken', { jwt }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }
}
