import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';

import { mapWithLimit } from '@canopus/shared';

import { AlertReader, LineRoute, TransportMode } from './alert-reader';
import { ScrapedAlert } from './alerts';
import { ServiceAlertBase } from './schemas/alert.schema';

// Notices come from a WordPress site, so they are read a few at a time. A run
// that suddenly has dozens of new alerts is a listing that broke, not a city
// that stopped running: the cap keeps that from becoming a bill.
const maxConcurrentArticles = 3;
const maxAnalyzedAlerts = 10;

/** An alteration as it leaves this service. */
export interface ServiceAlertResponse {
  id: string;
  title: string;
  url: string;
  /** The day the alteration was announced. */
  date?: string;
  /** When it runs, when the notice says so. */
  startDate?: string;
  endDate?: string;
  lines: string[];
  /** The stops the alert names; empty when it names none. */
  stations: string[];
  /**
   * Provisional stops the alteration puts on, named as the notice writes them
   * rather than by id — they are on no route. Empty for most.
   */
  addedStations: string[];
  /**
   * `'stations'` when only `stations` are affected and the rest of the route
   * runs as usual; `'line'` when every stop of every line named is.
   */
  scope: 'stations' | 'line';
}

/**
 * Where one operator's alterations come from, and what its notices say.
 *
 * The store does the same thing with either: list what is being shown, read
 * what changed, keep the rest. What differs between a bus alteration and a
 * tram one is which site is asked and what it is called there, which is all
 * that is behind this.
 */
export interface AlertSource {
  /** Which network published it: what the notice is read as, and logged as. */
  mode: TransportMode;
  /** The alterations the operator is showing right now. */
  list(): Promise<ScrapedAlert[]>;
  /**
   * Whether a listing with nothing in it is an answer.
   *
   * For a source that can only fail by throwing it is: the tram's one notice
   * is a block the operator shows while something is wrong and takes away when
   * it is over, so no block means the line is running normally and what was
   * stored is over. For a source that returns nothing both when it published
   * nothing and when it could not be read, it is not, and an empty listing is
   * left alone rather than taken as the all-clear.
   */
  clearsWhenEmpty?: boolean;
  /** The words of one alert's notice, or '' when they cannot be read. */
  article(alert: ScrapedAlert): Promise<string>;
}

/** A day, `YYYY-MM-DD`, so many days from today. */
export const dayFrom = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * An alert with nothing left for its notice to tell us.
 *
 * It was read, and what it was read to say includes the day it ends: it will
 * take itself out of the listings when that day passes, so re-reading it every
 * morning buys nothing. Until the eve of that day, when the one edit that
 * would matter — an alteration extended — is worth a look.
 */
const settled = (alert?: ServiceAlertBase): boolean =>
  !!alert?.articleHash && !!alert.endDate && alert.endDate > dayFrom(1);

/**
 * The alterations still in force, newest first.
 *
 * Being stored is most of the answer: a run only keeps what the site was still
 * showing, and drops the rest. So there is no age to judge here — an
 * alteration announced in January and still under way is still under way, and
 * guessing otherwise from its date is what used to hide it. An end date, where
 * a notice gave one, retires it a day early rather than waiting for the
 * operator to take the notice down.
 */
export const activeAlerts = <T extends ServiceAlertBase>(alerts: T[]): T[] => {
  const today = dayFrom(0);
  const announced = (alert: T) =>
    (alert.date ?? alert.firstSeen ?? '').slice(0, 10);
  return alerts
    .filter((alert) => !alert.endDate || alert.endDate >= today)
    .sort((a, b) => announced(b).localeCompare(announced(a)));
};

// Everything else an alert carries — when it was first seen, what its notice
// hashed to — is how the record is kept up to date, and stays out of the
// response.
export const toAlertResponse = (
  alert: ServiceAlertBase,
): ServiceAlertResponse => ({
  id: alert.id,
  title: alert.title,
  url: alert.url,
  date: alert.date ?? undefined,
  startDate: alert.startDate ?? undefined,
  endDate: alert.endDate ?? undefined,
  lines: alert.lines ?? [],
  stations: alert.stations ?? [],
  addedStations: alert.addedStations ?? [],
  scope: alert.scope ?? 'line',
});

export const articleHash = (article: string) =>
  createHash('sha256').update(article).digest('hex');

/**
 * What an alert's notice was read to say, and the text that was read. Every
 * field of it comes from one reading, so they cannot disagree about which
 * version of the notice they describe.
 */
type ArticleReading = Pick<
  ServiceAlertBase,
  | 'startDate'
  | 'endDate'
  | 'stations'
  | 'addedStations'
  | 'scope'
  | 'articleHash'
>;

/**
 * The reading an alert carries, or the one an unread alert carries: no dates,
 * no stops, the whole line, and no text on record as having been read.
 */
const readingOf = (alert?: ServiceAlertBase): ArticleReading => ({
  startDate: alert?.startDate ?? null,
  endDate: alert?.endDate ?? null,
  stations: alert?.stations ?? [],
  addedStations: alert?.addedStations ?? [],
  scope: alert?.scope ?? 'line',
  articleHash: alert?.articleHash,
});

/**
 * What a run learned. An alert with no entry is one this run learned nothing
 * about — its text had not changed, or nobody could read it — and whatever is
 * stored for it stands.
 */
type ArticleReadings = Map<string, ArticleReading>;

/**
 * The alterations one operator publishes, kept up to date and read back.
 *
 * One store per mode, over that mode's own collection. Everything the bus and
 * the tram do with an alteration is the same thing — store what the site is
 * showing, drop what it has stopped showing, read the notices whose words
 * changed, and answer with what is in force today — and it is done here so
 * that the two cannot answer the same outage differently.
 */
export class AlertStore {
  // `Model<any>`, and deliberately: the store reads and writes only the fields
  // every alert has, and each network hands it a model over a different
  // document type whose only difference is the collection it sits in. Naming
  // one of them here would make the store the bus's with the tram borrowing it.
  constructor(
    private readonly model: Model<any>,
    private readonly reader: AlertReader,
    private readonly logger: Logger,
  ) {}

  async all(): Promise<ServiceAlertBase[]> {
    return this.model.find().sort({ id: 1 }).lean().exec();
  }

  /**
   * Stores the alterations the site is publishing.
   *
   * An alert is an extra on top of the lines, so nothing it does can fail the
   * run: a listing that cannot be read or parsed leaves the stored alerts
   * alone, and they age out on their own from the day they were announced.
   *
   * `routesOf` turns the lines an alert names into their stops in route order,
   * which is what lets a notice's words be resolved to the stops they mean.
   */
  async sync(
    source: AlertSource,
    routesOf: (lineIds: string[]) => LineRoute[],
  ): Promise<void> {
    try {
      const scraped = await source.list();
      if (!scraped.length && !source.clearsWhenEmpty) {
        this.logger.warn(`No ${source.mode} service alerts were published`);
        return;
      }

      const stored = new Map(
        (await this.all()).map((alert) => [alert.id, alert]),
      );
      const readings = await this.readArticles(
        source,
        scraped,
        stored,
        routesOf,
      );
      const now = new Date().toISOString();

      // Guarded because an empty listing now reaches here: it is the all-clear
      // from a source that says so, and Mongo refuses an empty batch.
      if (scraped.length)
        await this.model.bulkWrite(
          scraped.map((alert) => {
            const previous = stored.get(alert.id);
            return {
              updateOne: {
                filter: { id: alert.id },
                update: {
                  $set: {
                    ...alert,
                    // This run's reading where it made one, and otherwise the
                    // one the alert already carried.
                    ...(readings.get(alert.id) ?? readingOf(previous)),
                    firstSeen: previous?.firstSeen ?? now,
                  },
                },
                upsert: true,
              },
            };
          }),
          { ordered: false },
        );

      // What the site has stopped showing is over, and nothing else says so:
      // these notices carry no end date and the ones that do are the minority.
      // Dropping them here is what lets the responses stop guessing from a
      // date. Only ever reached with a listing that answered — an endpoint
      // that failed returns nothing at all and leaves the run before this.
      const listed = new Set(scraped.map((alert) => alert.id));
      const gone = [...stored.keys()].filter((id) => !listed.has(id));
      if (gone.length) {
        await this.model.deleteMany({ id: { $in: gone } });
      }

      this.logger.log(
        `Read ${scraped.length} ${source.mode} service alerts, dropped ${gone.length}`,
      );
    } catch (exception) {
      this.logger.warn(
        `Could not update the ${source.mode} service alerts: ${exception.message}`,
      );
    }
  }

  /**
   * Reads the notice behind each alert whose text has changed.
   *
   * The listing gives a headline and a line list; when an alteration ends and
   * which stops it names are written in prose, differently by every author. A
   * model reads that, and only for a notice whose text is not the one already
   * read — the same words cannot yield different dates.
   *
   * Nothing here can fail the run: with no model configured, or a notice that
   * will not load, or a reading that fails its checks, the alert keeps exactly
   * what its listing said.
   */
  private async readArticles(
    source: AlertSource,
    scraped: ScrapedAlert[],
    stored: Map<string, ServiceAlertBase>,
    routesOf: (lineIds: string[]) => LineRoute[],
  ): Promise<ArticleReadings> {
    const readings: ArticleReadings = new Map();
    if (!this.reader.enabled) return readings;

    // Most mornings this is empty: the alerts on the listing are the ones read
    // yesterday, and an alert whose end date is known is not fetched at all.
    const unsettled = scraped.filter((alert) => !settled(stored.get(alert.id)));
    if (!unsettled.length) return readings;

    const articles = await mapWithLimit(
      unsettled,
      maxConcurrentArticles,
      async (alert) => ({ alert, article: await source.article(alert) }),
    );
    // A notice whose text is the one already read says nothing new; one that
    // could not be fetched says nothing at all. Both leave the stored reading
    // exactly where it is.
    const pending = articles
      .filter(
        ({ alert, article }) =>
          article && articleHash(article) !== stored.get(alert.id)?.articleHash,
      )
      .slice(0, maxAnalyzedAlerts);
    if (!pending.length) return readings;

    // The readings are independent of each other, and the model is not the
    // operator's site: they go out together.
    await mapWithLimit(
      pending,
      maxConcurrentArticles,
      async ({ alert, article }) => {
        const details = await this.reader.read(
          alert,
          article,
          routesOf(alert.lines),
          source.mode,
        );
        // Words nobody has read cannot hold a notice to a few stops, so a
        // notice that changed and could not be read clears what the last one
        // said — its hash included, so the next run tries again.
        readings.set(
          alert.id,
          details
            ? { ...details, articleHash: articleHash(article) }
            : readingOf(),
        );
      },
    );
    const read = [...readings.values()].filter(
      (reading) => reading.articleHash,
    ).length;
    this.logger.log(`Read the notice of ${read} ${source.mode} service alerts`);
    return readings;
  }
}

/**
 * The alerts a stop should show: the ones that name it, and no others.
 *
 * A stop's board answers one question — what is altered here — and a notice
 * that names lines without naming stops does not answer it. Those are the
 * line's, and they are read on the line, where a traveller is choosing a
 * route rather than standing at a pole. So a notice reaches a stop only where
 * reading it resolved the stop out of the notice's own words; a notice that
 * named none reaches no stop at all.
 */
export const alertsForStation = (
  alerts: ServiceAlertResponse[],
  id: string,
): ServiceAlertResponse[] =>
  alerts.filter((alert) => alert.stations.includes(id));
