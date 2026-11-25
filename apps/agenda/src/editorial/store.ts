import { HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EDITORIAL, REVISION } from '../schemas/schemas';
import { EDITIONS, SERIES } from '../seeds/series';
import {
  EDITORIAL_COLLECTIONS,
  EditorialCollection,
  EditorialState,
  validate,
  Verified,
} from './documents';

export interface EditorialRow {
  collection: EditorialCollection;
  key: string;
  state: EditorialState;
  doc: any;
  verified?: Verified;
  reason?: string;
  by?: string;
  version: number;
  updatedAt?: Date;
}

export interface WriteInput {
  doc: any;
  state?: EditorialState;
  verified?: Verified;
  reason: string;
  by: string;
}

const invalid = (message: string, details?: unknown) =>
  new HttpException(
    { statusCode: 400, error: { code: 'invalid_param', message, details } },
    400,
  );

const collectionOf = (value: string): EditorialCollection => {
  if (!EDITORIAL_COLLECTIONS.includes(value as EditorialCollection)) {
    throw invalid(
      `No editorial collection "${value}": ${EDITORIAL_COLLECTIONS.join(', ')}`,
    );
  }
  return value as EditorialCollection;
};

/**
 * The editorial store: what people write, with its history.
 *
 * What git would have given (docs/agenda/content.md) is kept here instead:
 * every write records the whole document before and after, who and why, and
 * any revision can be put back. A document is `draft`, `ready` or
 * `published`; only `published` reaches readers, through the same pipeline
 * and validation as every other source.
 */
@Injectable()
export class EditorialStore {
  constructor(
    @InjectModel(EDITORIAL) private readonly docs: Model<any>,
    @InjectModel(REVISION) private readonly revisions: Model<any>,
  ) {}

  async list(
    collection: string,
    state?: EditorialState,
  ): Promise<EditorialRow[]> {
    const filter: Record<string, unknown> = {
      collection: collectionOf(collection),
    };
    if (state) filter.state = state;
    return this.docs
      .find(filter, { _id: 0 })
      .sort({ key: 1 })
      .lean<EditorialRow[]>();
  }

  async published(collection: EditorialCollection): Promise<EditorialRow[]> {
    return this.docs
      .find({ collection, state: 'published' }, { _id: 0 })
      .lean<EditorialRow[]>();
  }

  async get(collection: string, key: string): Promise<EditorialRow> {
    const row = await this.docs
      .findOne({ collection: collectionOf(collection), key }, { _id: 0 })
      .lean();
    if (!row) {
      throw new HttpException(
        {
          statusCode: 404,
          error: { code: 'not_found', message: `No ${collection} "${key}"` },
        },
        404,
      );
    }
    return row as EditorialRow;
  }

  /** Writes a document. A published one stays published: an edit to a live time is live. */
  async put(
    collection: string,
    key: string,
    input: WriteInput,
  ): Promise<EditorialRow> {
    const c = collectionOf(collection);
    if (!input?.reason?.trim()) throw invalid('Every change needs a `reason`');
    const doc = { ...input.doc, key };
    const errors = validate(c, doc);
    if (errors.length) throw invalid(`The ${c} "${key}" is not valid`, errors);

    const before = await this.docs
      .findOne({ collection: c, key }, { _id: 0 })
      .lean<EditorialRow>();
    const state = input.state ?? before?.state ?? 'draft';
    const after = {
      collection: c,
      key,
      state,
      doc,
      verified: input.verified ?? before?.verified,
      reason: input.reason,
      by: input.by,
      version: (before?.version ?? 0) + 1,
    };
    await this.docs.updateOne(
      { collection: c, key },
      { $set: after },
      { upsert: true },
    );
    await this.record(
      c,
      key,
      before ? 'update' : 'create',
      before,
      after,
      input.by,
      input.reason,
    );
    return after as EditorialRow;
  }

  async setState(
    collection: string,
    key: string,
    state: EditorialState,
    by: string,
    reason: string,
  ): Promise<EditorialRow> {
    const before = await this.get(collection, key);
    if (state === 'published') {
      const errors = validate(before.collection, before.doc);
      if (errors.length)
        throw invalid(`The ${collection} "${key}" is not valid`, errors);
    }
    const after = { ...before, state, by, reason, version: before.version + 1 };
    await this.docs.updateOne(
      { collection: before.collection, key },
      { $set: after },
    );
    await this.record(
      before.collection,
      key,
      state === 'published' ? 'publish' : 'unpublish',
      before,
      after,
      by,
      reason,
    );
    return after;
  }

  /**
   * A whole programme at once, as drafts: what the PDF parser writes.
   *
   * Each document is validated on its own; the ones that fail are reported
   * and the rest are written, so a 750-act programme with three bad lines is
   * three lines to fix, not a programme to resend.
   */
  async bulk(
    items: { collection: string; doc: any }[],
    by: string,
    reason: string,
    state: EditorialState = 'draft',
  ) {
    const report: {
      collection: string;
      key?: string;
      ok: boolean;
      errors?: string[];
    }[] = [];
    for (const item of items ?? []) {
      try {
        const row = await this.put(item.collection, item.doc?.key, {
          doc: item.doc,
          state,
          reason,
          by,
        });
        report.push({ collection: row.collection, key: row.key, ok: true });
      } catch (exception) {
        const details = exception?.getResponse?.()?.error;
        report.push({
          collection: item.collection,
          key: item.doc?.key,
          ok: false,
          errors: details?.details ?? [details?.message ?? String(exception)],
        });
      }
    }
    return {
      written: report.filter((r) => r.ok).length,
      failed: report.filter((r) => !r.ok).length,
      report,
    };
  }

  async history(collection: string, key: string) {
    return this.revisions
      .find({ collection: collectionOf(collection), key })
      .sort({ at: -1 })
      .limit(100)
      .lean();
  }

  /** Puts a revision's `before` back, as a new revision. */
  async revert(revisionId: string, by: string, reason: string) {
    const revision = await this.revisions.findById(revisionId).lean();
    if (!revision) {
      throw new HttpException(
        {
          statusCode: 404,
          error: { code: 'not_found', message: `No revision ${revisionId}` },
        },
        404,
      );
    }
    const { collection, key, before } = revision as any;
    const current = await this.docs
      .findOne({ collection, key }, { _id: 0 })
      .lean();
    if (!before) {
      await this.docs.updateOne(
        { collection, key },
        {
          $set: {
            state: 'draft',
            by,
            reason,
            version: ((current as any)?.version ?? 0) + 1,
          },
        },
      );
    } else {
      await this.docs.updateOne(
        { collection, key },
        {
          $set: {
            ...before,
            by,
            reason,
            version: ((current as any)?.version ?? 0) + 1,
          },
        },
        { upsert: true },
      );
    }
    const after = await this.docs
      .findOne({ collection, key }, { _id: 0 })
      .lean();
    await this.record(collection, key, 'revert', current, after, by, reason);
    return after;
  }

  /** Every editorial document and the last 90 days of revisions: the backup, and a way out. */
  async export() {
    const since = new Date(Date.now() - 90 * 86400000);
    return {
      exportedAt: new Date().toISOString(),
      documents: await this.docs.find({}, { _id: 0 }).lean(),
      revisions: await this.revisions.find({ at: { $gte: since } }).lean(),
    };
  }

  /**
   * The first time the store is empty, the series and editions that used to
   * be written in code go in as published documents, with the same keys, so
   * the ids already handed out stay theirs.
   */
  async bootstrap(): Promise<number> {
    if (
      (await this.docs.countDocuments({
        collection: { $in: ['series', 'editions'] },
      })) > 0
    ) {
      return 0;
    }
    let written = 0;
    for (const series of SERIES) {
      const { known: _known, ...doc } = series;
      await this.put('series', series.key, {
        doc,
        state: 'published',
        reason: 'Moved from seeds/series.ts',
        by: 'bootstrap',
      });
      written++;
    }
    for (const edition of EDITIONS) {
      const { verified, ...doc } = edition;
      await this.put('editions', edition.key, {
        doc,
        state: 'published',
        verified,
        reason: 'Moved from seeds/series.ts',
        by: 'bootstrap',
      });
      written++;
    }
    return written;
  }

  private record(
    collection: string,
    key: string,
    op: string,
    before: unknown,
    after: unknown,
    by: string,
    reason: string,
  ) {
    return this.revisions.create({
      collection,
      key,
      op,
      before,
      after,
      by,
      reason,
      at: new Date(),
    });
  }
}
