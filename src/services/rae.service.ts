import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { Response } from 'express';

@Injectable()
export class RAEService {
  @Inject('RAE_SERVICE') private client: ClientProxy;

  public search(res: Response, term: string): Promise<string> {
    return lastValueFrom(this.client.send<any, any>('search', { term })).then(
      (response) => {
        if (response.statusCode) res.statusCode = response.statusCode;
        return response;
      },
    );
  }
}
