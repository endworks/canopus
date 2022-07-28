import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Response } from 'express';
import { lastValueFrom } from 'rxjs';
import { Activity } from 'src/models/sex-tracker.interface';

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

  public activities(res: Response, solo?: boolean): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('activities', { solo }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public activityById(res: Response, id: number): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('activityById', { id }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public createActivity(res: Response, activity: Activity): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('createActivity', { activity }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public deleteActivityById(res: Response, id: number): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('deleteActivityById', { id }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }

  public updateActivityById(
    res: Response,
    id: number,
    activity: Activity,
  ): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>('updateActivityById', { id, activity }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }
}
