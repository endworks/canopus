import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { reportOnce } from '@canopus/nest';
import { REVIEW, RUN } from '../schemas/schemas';
import { EVENT } from '../schemas/schemas';
import { Identities } from './identities';

/** Past this, the API says its data may be out of date. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

const GONE_NOTE = {
  es: 'Ya no aparece en la agenda municipal',
  en: 'No longer in the city’s agenda',
};

/**
 * What a person has to know about, and what the API has to admit.
 *
 * - A record the city takes down before its event is over may be a
 *   cancellation. The event leaves the lists at once (still found by id and
 *   by search, with a note), and a review is opened. If the record comes
 *   back, so does the event, and the review closes itself.
 * - A run that fails is reported to Sentry, once per kind of failure per
 *   hour, rather than only logged.
 * - When the last good import is more than twelve hours old, every answer
 *   says so (`meta.stale`), so the app can say the data may be out of date
 *   instead of presenting it as current.
 */
@Injectable()
export class Watchdog {
  private readonly logger = new Logger(Watchdog.name);
  private lastGood?: { at: Date; checked: number };

  constructor(
    private readonly identities: Identities,
    @InjectModel(EVENT) private readonly events: Model<any>,
    @InjectModel(REVIEW) private readonly reviews: Model<any>,
    @InjectModel(RUN) private readonly runs: Model<any>,
  ) {}

  async disappeared(
    source: string,
    gone: { ref: string; payload: any }[],
    today: string,
  ): Promise<number> {
    const ids = await this.identities.load(source, 'events');
    let flagged = 0;
    for (const { ref, payload } of gone) {
      const endDate = String(payload?.endDate ?? '').slice(0, 10);
      // Over, and gone the way the city clears every finished event: normal.
      if (!endDate || endDate < today) continue;
      const id = ids.get(ref);
      if (!id) continue;
      const event = await this.events
        .findOne({ _id: id }, { title: 1, visibility: 1 })
        .lean();
      if (!event) continue;
      await this.events.updateOne(
        { _id: id },
        {
          $set: {
            visibility:
              (event as any).visibility === 'hidden' ? 'hidden' : 'searchable',
            visibilityRule: 'gone-from-source',
            statusNote: GONE_NOTE,
            contentHash: null,
          },
          $inc: { version: 1 },
        },
      );
      await this.open(
        'disappeared',
        { collection: 'events', id, source, ref },
        `${source}:${ref}`,
        {
          title: (event as any).title?.es,
          endDate,
        },
      );
      flagged++;
    }
    if (flagged > 0) {
      reportOnce(
        `agenda-disappeared-${today}`,
        `agenda: ${flagged} ${source} records disappeared before their events ended`,
        3_600_000,
      );
    }
    return flagged;
  }

  /** Records that came back: their events are rewritten by the publish that follows. */
  async returned(source: string, refs: string[]): Promise<void> {
    if (refs.length === 0) return;
    const ids = await this.identities.load(source, 'events');
    const eventIds = refs.map((r) => ids.get(r)).filter(Boolean);
    await this.events.updateMany(
      { _id: { $in: eventIds }, visibilityRule: 'gone-from-source' },
      { $unset: { statusNote: '' }, $set: { contentHash: null } },
    );
    await this.reviews.updateMany(
      {
        kind: 'disappeared',
        subjectKey: { $in: refs.map((r) => `${source}:${r}`) },
        status: 'open',
      },
      {
        $set: {
          status: 'resolved',
          resolution: {
            by: 'source',
            at: new Date(),
            note: 'The record came back',
          },
        },
      },
    );
  }

  async staleEditions(
    rows: { key: string; doc: any; verified?: { at?: string } }[],
  ) {
    for (const row of rows) {
      await this.open(
        'stale-edition',
        { collection: 'editions', key: row.key },
        `editions:${row.key}`,
        {
          startDate: row.doc?.officialSpan?.startDate,
          lastVerified: row.verified?.at,
        },
      );
    }
    if (rows.length > 0) {
      reportOnce(
        'agenda-stale-editions',
        `agenda: editions starting soon with facts unchecked for two weeks: ${rows.map((r) => r.key).join(', ')}`,
        86_400_000,
      );
    }
  }

  failed(errors: { step: string; message: string }[]) {
    for (const error of errors) {
      this.logger.error(`${error.step}: ${error.message}`);
      reportOnce(
        `agenda-run-${error.step}`,
        `agenda: ${error.step} failed: ${error.message}`,
        3_600_000,
      );
    }
  }

  /** The last run in which the city's agenda imported without an error. Cached a minute. */
  async lastGoodImport(): Promise<Date | undefined> {
    if (this.lastGood && Date.now() - this.lastGood.checked < 60_000)
      return this.lastGood.at;
    const run = await this.runs
      .findOne({
        'counts.publish': { $exists: true },
        'errors.step': { $ne: 'city.agenda' },
      })
      .sort({ startedAt: -1 })
      .lean();
    const at = (run as any)?.finishedAt as Date | undefined;
    this.lastGood = { at, checked: Date.now() };
    return at;
  }

  async freshness(): Promise<{ lastImportAt?: string; stale: boolean }> {
    const at = await this.lastGoodImport();
    return {
      lastImportAt: at?.toISOString(),
      stale: !at || Date.now() - at.getTime() > STALE_AFTER_MS,
    };
  }

  forget() {
    this.lastGood = undefined;
  }

  /** One open review per subject and kind: a second sighting does not add another. */
  private async open(
    kind: string,
    subject: object,
    subjectKey: string,
    detail: object,
  ) {
    await this.reviews.updateOne(
      { kind, subjectKey, status: 'open' },
      {
        $setOnInsert: { kind, subject, subjectKey, status: 'open' },
        $set: { detail },
      },
      { upsert: true },
    );
  }
}
