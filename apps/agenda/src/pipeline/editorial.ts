import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { foldText } from '@canopus/shared';
import {
  EditionInput,
  EventInput,
  expandOccurrences,
  OfferInput,
  OverrideInput,
  PlaceInput,
  PlaceRef,
  SeriesInput,
} from '../editorial/documents';
import { EditorialRow, EditorialStore } from '../editorial/store';
import { slugify } from '../model/ids';
import { nextByRule } from '../model/rules';
import { addDays, fromLocal } from '../model/time';
import {
  MediaRef,
  EventDoc,
  FacetSource,
  Pricing,
  SeriesDoc,
} from '../model/types';
import { EVENT, PLACE, SERIES } from '../schemas/schemas';
import { Identities, IdentityMap } from './identities';
import { EditionLink, Publisher, ResolvedOverride } from './publisher';

export const EDITORIAL = 'editorial';

/** Days before an announced edition that it starts showing as upcoming. */
const SHOW_BEFORE_DAYS = 45;

/** The facet an editorial document's facts carry: verified when someone checked them. */
const facetOf = (row: EditorialRow, now: Date): FacetSource => ({
  source: EDITORIAL,
  ref: row.key,
  url: row.verified?.url,
  observedAt: now,
  verifiedAt: row.verified?.at ? fromLocal(row.verified.at) : undefined,
  confidence: row.verified ? 'verified' : 'official',
});

export const offersFrom = (
  offers: OfferInput[] | undefined,
  facet: FacetSource,
) => {
  const list = (offers ?? []).map((o) => ({
    ...o,
    currency: 'EUR' as const,
    availability: o.availability ?? 'unknown',
    provenance: facet,
  }));
  const free = list.filter((o) => o.free).length;
  const pricing: Pricing =
    list.length === 0
      ? 'unknown'
      : free === list.length
        ? 'free'
        : free === 0
          ? 'paid'
          : 'mixed';
  return { offers: list, pricing };
};

/**
 * The editorial layer into the published collections, and everything derived.
 *
 * Runs before every city import and after every editorial publish, so a time
 * fixed by hand is live in seconds and stays fixed through every re-import.
 * What it publishes:
 *
 * - series, editions, places, programmes and activities written by hand;
 * - the corrections on other sources' records (`overrides`), handed to the
 *   publisher so they are applied while those records are written;
 * - each edition's span, each series' current edition and its next expected
 *   date (docs/agenda/data-model.md, "Current edition").
 *
 * A document taken out of `published` takes its published entity with it:
 * `removed`, which answers by id and is listed nowhere.
 */
@Injectable()
export class Editorial {
  constructor(
    private readonly store: EditorialStore,
    private readonly identities: Identities,
    private readonly publisher: Publisher,
    @InjectModel(SERIES) private readonly series: Model<any>,
    @InjectModel(EVENT) private readonly events: Model<any>,
    @InjectModel(PLACE) private readonly places: Model<any>,
  ) {}

  async materialise(today: string, now = new Date()) {
    await this.store.bootstrap();
    const seriesIds = await this.identities.load(EDITORIAL, 'series');
    const eventIds = await this.identities.load(EDITORIAL, 'events');
    const placeIds = await this.identities.load(EDITORIAL, 'places');
    const counts = { series: 0, editions: 0, places: 0, events: 0, removed: 0 };

    const seriesKinds = new Map<string, string[]>();
    for (const row of await this.store.published('series')) {
      await this.publishSeries(row, seriesIds.resolve(row.key), now);
      seriesKinds.set(row.key, (row.doc as SeriesInput).kinds);
      counts.series++;
    }
    await seriesIds.flush();

    const editions = await this.store.published('editions');
    for (const row of editions) {
      const doc = row.doc as EditionInput;
      await this.publishEdition(
        row,
        eventIds.resolve(row.key),
        seriesIds.get(doc.series),
        seriesKinds.get(doc.series) ?? ['festivity'],
        now,
      );
      counts.editions++;
    }

    for (const row of await this.store.published('places')) {
      await this.publishPlace(row, placeIds, eventIds, now);
      counts.places++;
    }
    await placeIds.flush();

    // Parents before children: a programme before the activities inside it.
    const events = await this.store.published('events');
    const ordered: EditorialRow[] = [];
    const placed = new Set(editions.map((e) => e.key));
    let pending = events;
    while (pending.length > 0) {
      const ready = pending.filter((r) =>
        placed.has((r.doc as EventInput).parent),
      );
      if (ready.length === 0) break;
      for (const r of ready) {
        ordered.push(r);
        placed.add(r.key);
      }
      pending = pending.filter((r) => !placed.has(r.key));
    }
    const resolvePlace = await this.placeResolver(placeIds);
    for (const row of ordered) {
      await this.publishEvent(row, eventIds, resolvePlace, today, now);
      counts.events++;
    }
    await eventIds.flush();

    counts.removed = await this.removeUnpublished(
      new Set(
        [...editions, ...ordered]
          .map((r) => eventIds.get(r.key))
          .filter(Boolean),
      ),
      new Set(
        (await this.store.published('places'))
          .map((r) => placeIds.get(r.key))
          .filter(Boolean),
      ),
    );
    await this.applyIdOverrides(now);
    return { ...counts, orphans: pending.map((r) => r.key) };
  }

  private async publishSeries(row: EditorialRow, id: string, now: Date) {
    const doc = row.doc as SeriesInput;
    const facet = facetOf(row, now);
    await this.series.updateOne(
      { _id: id },
      {
        $set: {
          name: doc.name,
          summary: doc.summary,
          kinds: doc.kinds,
          links: doc.links ?? [],
          recurrence: {
            pattern: doc.pattern,
            usualMonths: doc.usualMonths,
            rule: doc.rule,
            precision: doc.precision,
          },
          display: { showBeforeDays: SHOW_BEFORE_DAYS },
          searchText: foldText(`${doc.name.es ?? ''} ${doc.name.en ?? ''}`),
          provenance: { identity: facet, text: facet, schedule: facet },
        },
        $setOnInsert: { slug: row.key, slugHistory: [], media: [], version: 1 },
      },
      { upsert: true },
    );
  }

  private async publishEdition(
    row: EditorialRow,
    id: string,
    seriesId: string,
    kinds: string[],
    now: Date,
  ) {
    const doc = row.doc as EditionInput;
    const facet = facetOf(row, now);
    await this.events.updateOne(
      { _id: id },
      {
        $set: {
          type: 'edition',
          seriesId,
          ancestorIds: [],
          title: doc.title,
          kinds,
          tags: [],
          audience: { kind: 'all' },
          placeIds: [],
          officialSpan: doc.officialSpan,
          offers: [],
          pricing: 'unknown',
          links: doc.links ?? [],
          visibility: 'listed',
          status: 'scheduled',
          edition: {
            status: doc.status,
            dayStartsAt: doc.dayStartsAt ?? '06:00',
            guests: doc.guests,
          },
          cityLink: doc.linkCity ?? {},
          searchText: foldText(`${doc.title.es ?? ''} ${doc.title.en ?? ''}`),
          provenance: { identity: facet, schedule: facet, text: facet },
          ...(doc.image ? { media: [{ url: doc.image }] } : {}),
        },
        $setOnInsert: {
          slug: slugify(doc.title.es ?? doc.title.en ?? row.key),
          slugHistory: [],
          ...(doc.image ? {} : { media: [] }),
          changes: [],
          version: 1,
        },
      },
      { upsert: true },
    );
  }

  private async publishPlace(
    row: EditorialRow,
    placeIds: IdentityMap,
    eventIds: IdentityMap,
    now: Date,
  ) {
    const doc = row.doc as PlaceInput;
    const id = placeIds.resolve(row.key);
    const parent = doc.parent ? placeIds.get(doc.parent) : undefined;
    const facet = facetOf(row, now);
    const edition = doc.temporaryFor
      ? eventIds.get(doc.temporaryFor)
      : undefined;
    await this.places.updateOne(
      { _id: id },
      {
        $set: {
          type: doc.type ?? 'venue',
          kinds: doc.kinds,
          name: doc.name,
          aliases: [
            ...new Set([doc.name.es, ...(doc.aliases ?? [])].filter(Boolean)),
          ],
          parentId: parent,
          ancestorIds: parent ? [parent] : [],
          geo: { type: 'Point', coordinates: doc.geo },
          address: { ...doc.address, locality: 'Zaragoza' },
          hoursText: doc.hoursText,
          contact: { website: doc.website },
          temporary: edition ? { eventId: edition } : undefined,
          status: 'open',
          searchText: foldText(
            [doc.name.es, ...(doc.aliases ?? []), doc.address?.street].join(
              ' ',
            ),
          ),
          provenance: { identity: facet, place: facet },
        },
        $setOnInsert: {
          slug: `${slugify(doc.name.es ?? row.key)}-${id.slice(-6).toLowerCase()}`,
          slugHistory: [],
          links: [],
          media: [],
          version: 1,
        },
      },
      { upsert: true },
    );
  }

  /** An editorial place key, a published place id, or another source's place. */
  private async placeResolver(placeIds: IdentityMap) {
    const others = new Map<string, IdentityMap>();
    for (const source of ['city.agenda', 'city.facilities']) {
      others.set(source, await this.identities.load(source, 'places'));
    }
    return (ref?: PlaceRef): string | undefined => {
      if (!ref) return undefined;
      if (typeof ref === 'string')
        return ref.startsWith('plc_') ? ref : placeIds.get(ref);
      return others.get(ref.source)?.get(ref.ref);
    };
  }

  private async publishEvent(
    row: EditorialRow,
    eventIds: IdentityMap,
    resolvePlace: (ref?: PlaceRef) => string | undefined,
    today: string,
    now: Date,
  ) {
    const doc = row.doc as EventInput;
    const id = eventIds.resolve(row.key);
    const parentId = eventIds.get(doc.parent);
    const parent: EventDoc = await this.events
      .findOne({ _id: parentId })
      .lean();
    const ancestorIds = [...(parent?.ancestorIds ?? []), parentId];
    const root: EventDoc =
      parent?.type === 'edition'
        ? parent
        : await this.events.findOne({ _id: ancestorIds[0] }).lean();
    const facet = facetOf(row, now);
    const placeIds = (doc.places ?? []).map(resolvePlace).filter(Boolean);

    const occurrences = expandOccurrences(
      doc,
      resolvePlace,
      root?.edition?.dayStartsAt,
    );
    await this.publisher.publishOccurrences(
      id,
      ancestorIds,
      occurrences.map((o) => ({ ...o, placeRef: o.placeId })),
      (ref) => ref,
      placeIds[0],
      EDITORIAL,
      row.key,
      today,
      now,
      '0000-01-01',
    );
    const span = await this.publisher.spanOf(id);
    const { offers, pricing } = offersFrom(doc.offers, facet);
    const placeNames = placeIds.length
      ? (
          await this.places.find({ _id: { $in: placeIds } }, { name: 1 }).lean()
        ).map((p: any) => p.name?.es ?? '')
      : [];

    await this.events.updateOne(
      { _id: id },
      {
        $set: {
          type: doc.type,
          parentId,
          ancestorIds,
          title: doc.title,
          subtitle: doc.subtitle,
          summary: doc.summary,
          description: doc.description,
          kinds: doc.kinds,
          tags: [],
          audience: doc.audience ?? { kind: 'all' },
          placeIds,
          where: doc.where,
          route: doc.route?.length
            ? {
                stops: doc.route.map((s, i, all) => ({
                  name: s.name,
                  role:
                    s.role ??
                    (i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'via'),
                })),
              }
            : undefined,
          span,
          offers,
          pricing,
          links: doc.links ?? [],
          media: doc.image ? [{ url: doc.image }] : [],
          visibility: 'listed',
          visibilityRule: 'editorial',
          status: doc.status ?? 'scheduled',
          statusNote: doc.statusNote,
          searchText: foldText(
            [
              doc.title.es,
              doc.title.en,
              doc.subtitle?.es,
              ...placeNames,
              doc.where?.es,
            ]
              .filter(Boolean)
              .join(' '),
          ),
          provenance: {
            identity: facet,
            schedule: facet,
            place: facet,
            pricing: facet,
            text: facet,
            media: facet,
            classification: facet,
          },
        },
        $setOnInsert: {
          slug: `${slugify(doc.title.es ?? doc.title.en ?? row.key)}-${id.slice(-6).toLowerCase()}`,
          slugHistory: [],
          changes: [],
          version: 1,
        },
      },
      { upsert: true },
    );
  }

  private async removeUnpublished(
    liveEvents: Set<string>,
    livePlaces: Set<string>,
  ) {
    const events = await this.events.updateMany(
      {
        'provenance.identity.source': EDITORIAL,
        _id: { $nin: [...liveEvents] },
        status: { $ne: 'removed' },
      },
      {
        $set: { status: 'removed', visibility: 'hidden' },
        $inc: { version: 1 },
      },
    );
    await this.places.updateMany(
      {
        'provenance.identity.source': EDITORIAL,
        _id: { $nin: [...livePlaces] },
        status: { $ne: 'removed' },
      },
      { $set: { status: 'removed' }, $inc: { version: 1 } },
    );
    return events.modifiedCount ?? 0;
  }

  /**
   * The corrections on another source's records, ready for its publisher.
   * Keyed by that source's ref.
   */
  async overridesFor(
    source: string,
    now = new Date(),
  ): Promise<Map<string, ResolvedOverride>> {
    const eventIds = await this.identities.load(EDITORIAL, 'events');
    const out = new Map<string, ResolvedOverride>();
    for (const row of await this.store.published('overrides')) {
      const doc = row.doc as OverrideInput;
      if (!('source' in doc.target) || doc.target.source !== source) continue;
      out.set(doc.target.ref, await this.resolve(row, eventIds, now));
    }
    return out;
  }

  private async resolve(
    row: EditorialRow,
    eventIds: IdentityMap,
    now: Date,
  ): Promise<ResolvedOverride> {
    const doc = row.doc as OverrideInput;
    const facet = facetOf(row, now);
    let parent: ResolvedOverride['parent'];
    if (doc.set.parent) {
      const id = eventIds.get(doc.set.parent);
      const found = id
        ? await this.events
            .findOne({ _id: id }, { ancestorIds: 1 })
            .lean<Pick<EventDoc, 'ancestorIds'>>()
        : undefined;
      if (found) parent = { id, ancestorIds: found.ancestorIds ?? [] };
    }
    const fields: ResolvedOverride['fields'] = {};
    if (doc.set.title) fields.title = doc.set.title;
    if (doc.set.kinds) fields.kinds = doc.set.kinds;
    if (doc.set.visibility) fields.visibility = doc.set.visibility;
    if (doc.set.image) fields.media = [{ url: doc.set.image }];
    if (doc.set.offers) {
      const { offers, pricing } = offersFrom(doc.set.offers, facet);
      fields.offers = offers;
      fields.pricing = pricing;
    }
    return {
      key: row.key,
      parent,
      fields,
      status: doc.set.status,
      statusNote: doc.set.statusNote,
      facet,
    };
  }

  /** Corrections addressed to a published id rather than a source's record. */
  private async applyIdOverrides(now: Date) {
    const eventIds = await this.identities.load(EDITORIAL, 'events');
    for (const row of await this.store.published('overrides')) {
      const doc = row.doc as OverrideInput;
      if (!('id' in doc.target)) continue;
      const resolved = await this.resolve(row, eventIds, now);
      const set: Record<string, unknown> = {
        ...resolved.fields,
        overriddenBy: row.key,
      };
      if (resolved.status) set.status = resolved.status;
      if (resolved.statusNote) set.statusNote = resolved.statusNote;
      if (resolved.parent) {
        set.parentId = resolved.parent.id;
        set.ancestorIds = [...resolved.parent.ancestorIds, resolved.parent.id];
      }
      await this.events.updateOne({ _id: doc.target.id }, { $set: set });
    }
  }

  /** Where the city's records attach: each edition's programmes and portals. */
  async editionLinks(): Promise<EditionLink[]> {
    const editions = await this.events
      .find({ type: 'edition', status: { $ne: 'removed' } })
      .lean();
    return editions.map((e: any) => ({
      id: e._id,
      ancestorIds: e.ancestorIds ?? [],
      programmes: new Set<string>((e.cityLink?.programmes ?? []).map(foldText)),
      portals: new Set<string>((e.cityLink?.portals ?? []).map(foldText)),
      // A month either side: the city tags its Christmas family visits from
      // late October, and an edition's fair runs past its fiestas.
      from: addDays(e.officialSpan.startDate, -30),
      to: addDays(e.officialSpan.endDate, 30),
    }));
  }

  /** Spans, current editions and predictions, after every publish. */
  async derive(today: string): Promise<void> {
    const editions: EventDoc[] = await this.events
      .find({ type: 'edition', status: { $ne: 'removed' } })
      .lean();
    for (const edition of editions) {
      const official = edition.officialSpan;
      const children = await this.publisher.spanOf(edition._id, true);
      const startDate =
        children && children.startDate < official.startDate
          ? children.startDate
          : official.startDate;
      const endDate =
        children && children.endDate > official.endDate
          ? children.endDate
          : official.endDate;
      const picture = edition.media?.length
        ? undefined
        : await this.sharedPicture(edition._id);
      await this.events.updateOne(
        { _id: edition._id },
        {
          $set: {
            span: {
              starts: fromLocal(startDate),
              ends: fromLocal(addDays(endDate, 1)),
              startDate,
              endDate,
            },
            ...(picture ? { media: [picture] } : {}),
          },
        },
      );
    }

    const all: SeriesDoc[] = await this.series.find({}).lean();
    for (const series of all) {
      const mine = editions
        .filter((e) => e.seriesId === series._id)
        .sort((a, b) =>
          a.officialSpan.startDate.localeCompare(b.officialSpan.startDate),
        );
      const on = mine.find(
        (e) =>
          e.officialSpan.startDate <= today && e.officialSpan.endDate >= today,
      );
      const upcoming = mine.find((e) => e.officialSpan.startDate > today);
      const past = [...mine]
        .reverse()
        .find((e) => e.officialSpan.endDate < today);
      const current =
        on ??
        (upcoming &&
        upcoming.officialSpan.startDate <=
          addDays(today, series.display.showBeforeDays)
          ? upcoming
          : past);
      const next = nextExpected(series, upcoming, on, today);
      await this.series.updateOne(
        { _id: series._id },
        current
          ? { $set: { currentEditionId: current._id, nextExpected: next } }
          : { $set: { nextExpected: next }, $unset: { currentEditionId: '' } },
      );
    }
  }

  /**
   * The picture an edition without one of its own is shown with: the one most
   * of its activities share, which is the edition's own artwork — Navidad's
   * Z of a tree on every activity of the Plaza. A picture fewer than three
   * share, or under a fifth of the pictured ones, says nothing about the whole.
   */
  async sharedPicture(editionId: string): Promise<MediaRef | undefined> {
    const counted: { _id: string; count: number; media: MediaRef }[] =
      await this.events.aggregate([
        {
          $match: {
            ancestorIds: editionId,
            status: { $ne: 'removed' },
            'media.0.url': { $exists: true },
          },
        },
        {
          $group: {
            _id: { $arrayElemAt: ['$media.url', 0] },
            count: { $sum: 1 },
            media: { $first: { $arrayElemAt: ['$media', 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]);
    const pictured = counted.reduce((sum, c) => sum + c.count, 0);
    const [top] = counted;
    if (!top || top.count < 3 || top.count * 5 < pictured) return undefined;
    return top.media;
  }

  /** Editions starting within 30 days whose facts were last checked more than 14 days ago. */
  async staleEditions(today: string) {
    const soon = addDays(today, 30);
    const editions = await this.store.published('editions');
    return editions.filter((row) => {
      const doc = row.doc as EditionInput;
      if (doc.officialSpan.endDate < today || doc.officialSpan.startDate > soon)
        return false;
      return !row.verified?.at || row.verified.at < addDays(today, -14);
    });
  }
}

/**
 * When the next edition is expected, and how we know.
 *
 * An announced edition that has not started is the answer. Otherwise the rule,
 * asked from the day after whatever edition is on or last held, so that during
 * Navidad 2026 the next is Navidad 2027 and not the one already running.
 */
export const nextExpected = (
  series: Pick<SeriesDoc, 'recurrence'>,
  upcoming: Pick<EventDoc, 'officialSpan'> | undefined,
  on: Pick<EventDoc, 'officialSpan'> | undefined,
  today: string,
): SeriesDoc['nextExpected'] => {
  if (upcoming) {
    return {
      startDate: upcoming.officialSpan.startDate,
      endDate: upcoming.officialSpan.endDate,
      precision: 'day',
      basis: 'announced',
    };
  }
  const after = on ? addDays(on.officialSpan.endDate, 1) : today;
  const rule = series.recurrence.rule;
  if (rule) {
    const dates = nextByRule(rule, after);
    return { ...dates, precision: series.recurrence.precision, basis: 'rule' };
  }
  const months = series.recurrence.usualMonths ?? [];
  if (months.length === 0) return undefined;
  return {
    ...usualWindow(months, after),
    precision: 'season',
    basis: 'usual-months',
  };
};

/** The next run of the usual months, from its first day to its last. */
export const usualWindow = (months: number[], after: string) => {
  const sorted = [...months].sort((a, b) => a - b);
  const year = +after.slice(0, 4);
  for (const y of [year, year + 1]) {
    const startDate = `${y}-${String(sorted[0]).padStart(2, '0')}-01`;
    const lastMonth = sorted[sorted.length - 1];
    const endDate = addDays(
      lastMonth === 12
        ? `${y + 1}-01-01`
        : `${y}-${String(lastMonth + 1).padStart(2, '0')}-01`,
      -1,
    );
    if (startDate > after) return { startDate, endDate };
  }
  return { startDate: after, endDate: after };
};
