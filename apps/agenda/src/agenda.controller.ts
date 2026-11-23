import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { AGENDA_PATTERNS, SearchPayload } from '@canopus/shared';
import { AdminService } from './admin.service';
import { EditorialState } from './editorial/documents';
import { WriteInput } from './editorial/store';
import { Watchdog } from './pipeline/watchdog';
import {
  ComingUpQuery,
  EventQuery,
  FeedQuery,
  PlaceQuery,
  PlacesQuery,
  ReadService,
  ScheduleQuery,
} from './read/read.service';

interface Admin {
  by: string;
  reason?: string;
}

@Controller()
export class AgendaController {
  constructor(
    private readonly read: ReadService,
    private readonly admin: AdminService,
    private readonly watchdog: Watchdog,
  ) {}

  /**
   * Every read answer says how fresh it is: when the last good import
   * finished, and `stale` once that is more than twelve hours ago.
   */
  private async fresh<T extends { meta: object }>(
    answer: Promise<T>,
  ): Promise<T> {
    const [result, freshness] = await Promise.all([
      answer,
      this.watchdog.freshness(),
    ]);
    Object.assign(result.meta, freshness);
    return result;
  }

  @MessagePattern(AGENDA_PATTERNS.feed, Transport.TCP)
  feed(@Payload() query: FeedQuery) {
    return this.fresh(this.read.feed(query ?? {}));
  }

  @MessagePattern(AGENDA_PATTERNS.highlights, Transport.TCP)
  highlights(@Payload() query: { lang?: string }) {
    return this.fresh(this.read.highlights(query ?? {}));
  }

  @MessagePattern(AGENDA_PATTERNS.comingUp, Transport.TCP)
  comingUp(@Payload() query: ComingUpQuery) {
    return this.fresh(this.read.comingUp(query ?? {}));
  }

  @MessagePattern(AGENDA_PATTERNS.series, Transport.TCP)
  series(@Payload() query: { id: string; lang?: string }) {
    return this.fresh(this.read.seriesOne(query));
  }

  @MessagePattern(AGENDA_PATTERNS.event, Transport.TCP)
  event(@Payload() query: EventQuery) {
    return this.fresh(this.read.event(query));
  }

  @MessagePattern(AGENDA_PATTERNS.schedule, Transport.TCP)
  schedule(@Payload() query: ScheduleQuery) {
    return this.fresh(this.read.schedule(query));
  }

  @MessagePattern(AGENDA_PATTERNS.places, Transport.TCP)
  places(@Payload() query: PlacesQuery) {
    return this.fresh(this.read.placesList(query ?? {}));
  }

  @MessagePattern(AGENDA_PATTERNS.place, Transport.TCP)
  place(@Payload() query: PlaceQuery) {
    return this.fresh(this.read.place(query));
  }

  @MessagePattern(AGENDA_PATTERNS.taxonomy, Transport.TCP)
  taxonomy(@Payload() query: { lang?: string }) {
    return this.read.taxonomy(query ?? {});
  }

  @MessagePattern(AGENDA_PATTERNS.search, Transport.TCP)
  search(@Payload() query: SearchPayload & { lang?: string }) {
    return this.read.search(query);
  }

  @MessagePattern(AGENDA_PATTERNS.run, Transport.TCP)
  run() {
    return this.admin.run();
  }

  @MessagePattern(AGENDA_PATTERNS.status, Transport.TCP)
  status() {
    return this.admin.status();
  }

  @MessagePattern(AGENDA_PATTERNS.runs, Transport.TCP)
  runs(@Payload() payload: { limit?: number }) {
    return this.admin.runs(payload?.limit);
  }

  @MessagePattern(AGENDA_PATTERNS.editorialList, Transport.TCP)
  editorialList(@Payload() p: { collection: string; state?: EditorialState }) {
    return this.admin.list(p.collection, p.state);
  }

  @MessagePattern(AGENDA_PATTERNS.editorialGet, Transport.TCP)
  editorialGet(@Payload() p: { collection: string; key: string }) {
    return this.admin.get(p.collection, p.key);
  }

  @MessagePattern(AGENDA_PATTERNS.editorialPut, Transport.TCP)
  editorialPut(@Payload() p: { collection: string; key: string } & WriteInput) {
    return this.admin.put(p.collection, p.key, p);
  }

  @MessagePattern(AGENDA_PATTERNS.editorialState, Transport.TCP)
  editorialState(
    @Payload()
    p: { collection: string; key: string; state: EditorialState } & Admin,
  ) {
    return this.admin.setState(p.collection, p.key, p.state, p.by, p.reason);
  }

  @MessagePattern(AGENDA_PATTERNS.editorialBulk, Transport.TCP)
  editorialBulk(
    @Payload() p: { items: { collection: string; doc: any }[] } & Admin,
  ) {
    return this.admin.bulk(p.items, p.by, p.reason);
  }

  @MessagePattern(AGENDA_PATTERNS.editorialHistory, Transport.TCP)
  editorialHistory(@Payload() p: { collection: string; key: string }) {
    return this.admin.history(p.collection, p.key);
  }

  @MessagePattern(AGENDA_PATTERNS.editorialRevert, Transport.TCP)
  editorialRevert(@Payload() p: { revisionId: string } & Admin) {
    return this.admin.revert(p.revisionId, p.by, p.reason);
  }

  @MessagePattern(AGENDA_PATTERNS.editorialExport, Transport.TCP)
  editorialExport() {
    return this.admin.export();
  }

  @MessagePattern(AGENDA_PATTERNS.reviews, Transport.TCP)
  reviews(@Payload() p: { status?: string; kind?: string }) {
    return this.admin.listReviews(p?.status, p?.kind);
  }

  @MessagePattern(AGENDA_PATTERNS.reviewResolve, Transport.TCP)
  reviewResolve(
    @Payload()
    p: { id: string; action: 'resolve' | 'dismiss'; note?: string } & Admin,
  ) {
    return this.admin.resolveReview(p.id, p.action, p.by, p.note);
  }
}
