import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IdKind, newId } from '../model/ids';
import { IDENTITY } from '../schemas/schemas';

type Collection = 'series' | 'events' | 'places' | 'occurrences';

const KIND: Record<Collection, IdKind> = {
  series: 'series',
  events: 'event',
  places: 'place',
  occurrences: 'occurrence',
};

/**
 * A source's key for a record → the agenda's id for it.
 *
 * The reason ids survive re-imports (docs/agenda/ingestion.md, "Resolve"). The
 * whole map for a source is read once per run: a few thousand pairs, and one
 * query rather than one per record.
 */
@Injectable()
export class Identities {
  constructor(@InjectModel(IDENTITY) private readonly identities: Model<any>) {}

  async load(source: string, collection: Collection): Promise<IdentityMap> {
    const rows = await this.identities
      .find({ source, collection }, { ref: 1, entityId: 1 })
      .lean();
    return new IdentityMap(
      this.identities,
      source,
      collection,
      new Map(rows.map((r: any) => [r.ref, r.entityId])),
    );
  }
}

export class IdentityMap {
  private readonly pending: Record<string, unknown>[] = [];

  constructor(
    private readonly model: Model<any>,
    private readonly source: string,
    private readonly collection: Collection,
    private readonly map: Map<string, string>,
  ) {}

  get(ref: string): string | undefined {
    return this.map.get(ref);
  }

  /** The id for this ref: the one it already has, or a new one recorded now. */
  resolve(
    ref: string,
    method: 'exact' | 'matched' | 'manual' = 'exact',
    entityId?: string,
  ): string {
    const known = this.map.get(ref);
    if (known) return known;
    const id = entityId ?? newId(KIND[this.collection]);
    this.map.set(ref, id);
    this.pending.push({
      source: this.source,
      ref,
      collection: this.collection,
      entityId: id,
      method,
    });
    return id;
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    await this.model.insertMany(this.pending.splice(0), { ordered: false });
  }
}
