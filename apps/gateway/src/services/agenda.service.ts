import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { AGENDA_PATTERNS, SERVICE_TOKENS } from '@canopus/shared';

@Injectable()
export class AgendaService {
  @Inject(SERVICE_TOKENS.agenda) private client: ClientProxy;

  private send(pattern: string, payload: object) {
    return lastValueFrom(this.client.send(pattern, payload));
  }

  feed(payload: { from?: string; days?: number; lang?: string }) {
    return this.send(AGENDA_PATTERNS.feed, payload);
  }

  highlights(payload: { lang?: string }) {
    return this.send(AGENDA_PATTERNS.highlights, payload);
  }

  comingUp(payload: { nextWithin?: number; lang?: string }) {
    return this.send(AGENDA_PATTERNS.comingUp, payload);
  }

  series(payload: { id: string; lang?: string }) {
    return this.send(AGENDA_PATTERNS.series, payload);
  }

  event(payload: { id: string; include?: string[]; lang?: string }) {
    return this.send(AGENDA_PATTERNS.event, payload);
  }

  schedule(payload: {
    id: string;
    date?: string;
    kinds?: string[];
    pricing?: string;
    placeId?: string;
    lang?: string;
  }) {
    return this.send(AGENDA_PATTERNS.schedule, payload);
  }

  places(payload: {
    kinds?: string[];
    near?: [number, number];
    radius?: number;
    limit?: number;
    lang?: string;
  }) {
    return this.send(AGENDA_PATTERNS.places, payload);
  }

  place(payload: { id: string; include?: string[]; lang?: string }) {
    return this.send(AGENDA_PATTERNS.place, payload);
  }

  taxonomy(payload: { lang?: string }) {
    return this.send(AGENDA_PATTERNS.taxonomy, payload);
  }

  /** The admin side: only ever called behind the token check. */
  admin(pattern: string, payload: object = {}) {
    return this.send(pattern, payload);
  }
}
