import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { CitySource } from '../city/city.source';
import { CityEvent, CityFacility } from '../city/city-record';
import {
  facilityPlace,
  FACILITIES_SOURCE,
  normaliseEvent,
  SOURCE,
  todayInCity,
} from '../city/normalise';
import { addDays } from '../model/time';
import { EVENT, RUN } from '../schemas/schemas';
import { Editorial } from './editorial';
import { Publisher } from './publisher';
import { Watchdog } from './watchdog';

/** How long after starting the service the first import runs. */
const FIRST_RUN_DELAY_MS = 30_000;
/**
 * One rhythm, edition or not. An hourly full download of the city's list was
 * running when the city started refusing this server (25 November 2026), and
 * a programme that moves overnight is still caught within six hours.
 */
const EVERY_MS = 6 * 60 * 60 * 1000;
/** Slack, so a run that took a minute does not push the next one an hour later. */
const SLACK_MS = 5 * 60 * 1000;
/** How far apart runs get while the city keeps refusing: 6, 12, then 24 hours. */
const MAX_BACKOFF_STEPS = 2;
const EDITION_MARGIN_DAYS = 3;

type Step = { step: string; message: string };

/**
 * Keeps the published data current.
 *
 * Checked every hour. It runs when six hours have passed since the last run,
 * and backs off to twelve and then twenty-four while the city keeps failing
 * it, so a refusal is not met with the same request every six hours. A run:
 *
 * 1. publishes the editorial layer, so hand-written data is in place first;
 * 2. fetches and archives the city's agenda, and publishes it with the
 *    editorial corrections applied as each record is written;
 * 3. flags records that vanished before their events ended, and restores
 *    the ones that came back;
 * 4. fetches the museums;
 * 5. derives spans, current editions and next expected dates;
 * 6. once a day, flags editions starting soon whose facts nobody has checked
 *    lately.
 *
 * A run started while another is going is refused, not queued. Every run is
 * recorded in `runs`; failures also go to Sentry.
 */
@Injectable()
export class Importer implements OnApplicationBootstrap {
  private readonly logger = new Logger(Importer.name);
  private running = false;
  private lastStaleCheck?: string;

  constructor(
    private readonly city: CitySource,
    private readonly publisher: Publisher,
    private readonly editorial: Editorial,
    private readonly watchdog: Watchdog,
    @InjectModel(RUN) private readonly runs: Model<any>,
    @InjectModel(EVENT) private readonly events: Model<any>,
  ) {}

  onApplicationBootstrap() {
    if (process.env.AGENDA_IMPORT_ON_START === 'off') return;
    // Only when due: a deploy is not a reason to download the city's list again.
    setTimeout(
      () => void this.tick().catch(() => undefined),
      FIRST_RUN_DELAY_MS,
    ).unref();
  }

  @Cron('0 15 * * * *', { timeZone: 'Europe/Madrid' })
  async tick() {
    if (!(await this.due())) return;
    await this.runAll().catch(() => undefined);
  }

  /** Whether the next run is due: six hours on, longer while the city keeps failing. */
  async due(now = new Date()): Promise<boolean> {
    const recent = await this.runs
      .find({}, { startedAt: 1, errors: 1 })
      .sort({ startedAt: -1 })
      .limit(MAX_BACKOFF_STEPS + 1)
      .lean();
    if (!recent.length) return true;
    const since =
      now.getTime() - new Date((recent[0] as any).startedAt).getTime();
    return since >= this.interval(recent as any[]) - SLACK_MS;
  }

  /** Six hours, doubled for each run in a row the city failed, up to a day. */
  interval(recent: { errors?: Step[] }[]): number {
    let failures = 0;
    for (const run of recent.slice(0, MAX_BACKOFF_STEPS)) {
      if (!(run.errors ?? []).some((error) => error.step.startsWith('city.')))
        break;
      failures += 1;
    }
    return EVERY_MS * 2 ** failures;
  }

  async editionMode(today: string): Promise<boolean> {
    const on = await this.events.countDocuments({
      type: 'edition',
      status: { $ne: 'removed' },
      'officialSpan.startDate': { $lte: addDays(today, EDITION_MARGIN_DAYS) },
      'officialSpan.endDate': { $gte: addDays(today, -EDITION_MARGIN_DAYS) },
    });
    return on > 0;
  }

  /**
   * What an editorial publish needs to be live at once, without a fetch.
   *
   * A correction on a city record is applied as that record is written, so
   * publishing one replays the city's records from the archive (current ones
   * only) with the corrections in place: about twenty seconds, not six hours.
   */
  async publishEditorial(
    collection?: string,
  ): Promise<Record<string, unknown>> {
    if (this.running) return { refused: 'a run is already going' };
    this.running = true;
    try {
      const today = todayInCity();
      const now = new Date();
      const counts: Record<string, unknown> = {
        editorial: await this.editorial.materialise(today, now),
      };
      if (collection === 'overrides') {
        const records = await this.city.stored<CityEvent>(SOURCE, true);
        counts.republished = await this.publisher.publishEvents(
          SOURCE,
          records
            .map((record) => normaliseEvent(record, today))
            .filter(Boolean),
          await this.editorial.editionLinks(),
          today,
          now,
          await this.editorial.overridesFor(SOURCE, now),
        );
      }
      await this.editorial.derive(today);
      return counts;
    } finally {
      this.running = false;
    }
  }

  async runAll(): Promise<Record<string, unknown>> {
    if (this.running) return { refused: 'a run is already going' };
    this.running = true;
    const startedAt = new Date();
    const counts: Record<string, unknown> = {};
    const errors: Step[] = [];
    const today = todayInCity(startedAt);
    const attempt = async (step: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (exception) {
        errors.push({ step, message: exception?.message ?? String(exception) });
      }
    };

    try {
      counts.editionMode = await this.editionMode(today);
      await attempt('editorial', async () => {
        counts.editorial = await this.editorial.materialise(today, startedAt);
      });

      await attempt('city.agenda', async () => {
        const events = await this.city.fetchEvents(today);
        counts.fetched = events.length;
        const archived = await this.city.archive(SOURCE, events, startedAt);
        counts.archive = {
          created: archived.created,
          changed: archived.changed.size,
          gone: archived.gone,
          newlyGone: archived.newlyGone.length,
          returned: archived.returned.length,
        };
        await this.watchdog.returned(SOURCE, archived.returned);
        const candidates = events
          .map((record: CityEvent) => normaliseEvent(record, today))
          .filter(Boolean);
        counts.publish = await this.publisher.publishEvents(
          SOURCE,
          candidates,
          await this.editorial.editionLinks(),
          today,
          startedAt,
          await this.editorial.overridesFor(SOURCE, startedAt),
        );
        counts.disappeared = await this.watchdog.disappeared(
          SOURCE,
          archived.newlyGone,
          today,
        );
      });

      await attempt('city.facilities', async () => {
        const museums = await this.city.fetchMuseums();
        await this.city.archive(FACILITIES_SOURCE, museums, startedAt);
        const places = museums
          .map((m: CityFacility) => facilityPlace(m))
          .filter(Boolean);
        const { created, updated } = await this.publisher.publishPlaces(
          FACILITIES_SOURCE,
          places,
          startedAt,
        );
        counts.museums = { fetched: museums.length, created, updated };
      });

      await attempt('derive', () => this.editorial.derive(today));

      if (this.lastStaleCheck !== today) {
        await attempt('freshness', async () => {
          const stale = await this.editorial.staleEditions(today);
          await this.watchdog.staleEditions(stale);
          counts.staleEditions = stale.map((r) => r.key);
          this.lastStaleCheck = today;
        });
      }
    } finally {
      this.running = false;
    }

    const finishedAt = new Date();
    await this.runs.create({
      source: 'all',
      startedAt,
      finishedAt,
      counts,
      errors,
    });
    this.watchdog.forget();
    this.watchdog.failed(errors);
    this.logger.log(
      `import finished in ${+finishedAt - +startedAt} ms: ${JSON.stringify(counts)}`,
    );
    return { startedAt, finishedAt, counts, errors };
  }

  async recentRuns(limit = 20) {
    return this.runs
      .find({}, { _id: 0 })
      .sort({ startedAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
  }
}
