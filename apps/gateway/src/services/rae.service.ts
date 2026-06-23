import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { Response } from 'express';
import { RAE_PATTERNS, SERVICE_TOKENS } from '@canopus/shared';

@Injectable()
export class RAEService {
  @Inject(SERVICE_TOKENS.rae) private client: ClientProxy;

  public search(res: Response, term: string): Promise<string> {
    return lastValueFrom(
      this.client.send<any, any>(RAE_PATTERNS.search, { term }),
    ).then((response) => {
      if (response.statusCode) res.statusCode = response.statusCode;
      return response;
    });
  }
}
