import { HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { todayInCity } from './city/normalise';
import { EditorialStore, WriteInput } from './editorial/store';
import { EditorialState } from './editorial/documents';
import { Importer } from './pipeline/importer';
import { Watchdog } from './pipeline/watchdog';
import { REVIEW } from './schemas/schemas';

/**
 * The admin side: what the gateway's token-guarded routes call.
 *
 * A write to a published document goes live at once (`publishEditorial`);
 * a draft waits for its publish. Everything a person does is a revision.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly store: EditorialStore,
    private readonly importer: Importer,
    private readonly watchdog: Watchdog,
    @InjectModel(REVIEW) private readonly reviews: Model<any>,
  ) {}

  list(collection: string, state?: EditorialState) {
    return this.store.list(collection, state);
  }

  get(collection: string, key: string) {
    return this.store.get(collection, key);
  }

  async put(collection: string, key: string, input: WriteInput) {
    const row = await this.store.put(collection, key, input);
    const published =
      row.state === 'published'
        ? await this.importer.publishEditorial(collection)
        : undefined;
    return { row, published };
  }

  async setState(
    collection: string,
    key: string,
    state: EditorialState,
    by: string,
    reason: string,
  ) {
    if (!reason?.trim()) {
      throw new HttpException(
        {
          statusCode: 400,
          error: {
            code: 'invalid_param',
            message: 'Every change needs a `reason`',
          },
        },
        400,
      );
    }
    const row = await this.store.setState(collection, key, state, by, reason);
    return { row, published: await this.importer.publishEditorial(collection) };
  }

  bulk(items: { collection: string; doc: any }[], by: string, reason: string) {
    return this.store.bulk(items, by, reason);
  }

  history(collection: string, key: string) {
    return this.store.history(collection, key);
  }

  async revert(revisionId: string, by: string, reason: string) {
    const row: any = await this.store.revert(revisionId, by, reason);
    return {
      row,
      published: await this.importer.publishEditorial(row?.collection),
    };
  }

  export() {
    return this.store.export();
  }

  listReviews(status = 'open', kind?: string) {
    const filter: Record<string, unknown> = { status };
    if (kind) filter.kind = kind;
    return this.reviews.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  async resolveReview(
    id: string,
    action: 'resolve' | 'dismiss',
    by: string,
    note?: string,
  ) {
    const review = await this.reviews.findByIdAndUpdate(
      id,
      {
        $set: {
          status: action === 'dismiss' ? 'dismissed' : 'resolved',
          resolution: { by, at: new Date(), note },
        },
      },
      { new: true },
    );
    if (!review) {
      throw new HttpException(
        {
          statusCode: 404,
          error: { code: 'not_found', message: `No review ${id}` },
        },
        404,
      );
    }
    return review;
  }

  async status() {
    const today = todayInCity();
    return {
      today,
      editionMode: await this.importer.editionMode(today),
      due: await this.importer.due(),
      ...(await this.watchdog.freshness()),
      openReviews: await this.reviews.aggregate([
        { $match: { status: 'open' } },
        { $group: { _id: '$kind', count: { $sum: 1 } } },
      ]),
      runs: await this.importer.recentRuns(5),
    };
  }

  run() {
    return this.importer.runAll();
  }

  runs(limit?: number) {
    return this.importer.recentRuns(limit);
  }
}
