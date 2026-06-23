import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { RAE_PATTERNS, SERVICE_TOKENS } from '@canopus/shared';

@Injectable()
export class RAEService {
  @Inject(SERVICE_TOKENS.rae) private client: ClientProxy;

  search(term: string) {
    return lastValueFrom(this.client.send(RAE_PATTERNS.search, { term }));
  }
}
