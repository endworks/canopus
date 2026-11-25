import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  rankHits,
  SEARCH_MAX_QUERY,
  searchable,
  SearchHit,
  SearchHitType,
} from '@canopus/shared';
import { AgendaIndex, searchAgenda } from './search-index';
import { KINDS, NOTICE_KINDS, PLACE_KINDS } from '../model/taxonomy';
import { addDays, fromLocal, localDate } from '../model/time';
import { EventDoc, OccurrenceDoc, PlaceDoc, SeriesDoc } from '../model/types';
import { EVENT, OCCURRENCE, PLACE, SERIES } from '../schemas/schemas';
import {
  apiError,
  envelope,
  eventDetail,
  eventSummary,
  highlightLabel,
  Lang,
  lang,
  occurrenceView,
  placeDetail,
  placeSummary,
  seriesView,
  sourcesOf,
} from './views';

const LIVE = { status: { $ne: 'removed' } };
/** How many hits a search may ask for: the gateway pages through at most this many. */
const MAX_SEARCH_HITS = 200;
/** The agenda changes at an import, every six hours; a search may lag it ten minutes. */
const SEARCH_INDEX_TTL_MS = 10 * 60 * 1000;
const MAX_FEED_DAYS = 60;

export interface FeedQuery {
  from?: string;
  days?: number;
  lang?: string;
}
export interface EventQuery {
  id: string;
  include?: string[];
  lang?: string;
}
export interface ScheduleQuery {
  id: string;
  date?: string;
  kinds?: string[];
  pricing?: string;
  placeId?: string;
  lang?: string;
}
export interface PlacesQuery {
  kinds?: string[];
  near?: [number, number];
  radius?: number;
  limit?: number;
  lang?: string;
}
export interface PlaceQuery {
  id: string;
  include?: string[];
  lang?: string;
}
export interface ComingUpQuery {
  nextWithin?: number;
  lang?: string;
}
export interface AgendaSearchQuery {
  q: string;
  types?: SearchHitType[];
  limit?: number;
  lang?: string;
}

const isDate = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** What the API reads. Nothing here writes. */
@Injectable()
export class ReadService {
  constructor(
    @InjectModel(EVENT) private readonly events: Model<any>,
    @InjectModel(OCCURRENCE) private readonly occurrences: Model<any>,
    @InjectModel(PLACE) private readonly places: Model<any>,
    @InjectModel(SERIES) private readonly series: Model<any>,
  ) {}

  private today() {
    return localDate(new Date());
  }

  /** Everything `occurrences` and `events` refer to, keyed by id. */
  private async include(
    events: EventDoc[],
    occurrences: OccurrenceDoc[],
    l: Lang,
  ) {
    const placeIds = new Set<string>();
    for (const e of events) e.placeIds?.forEach((p) => placeIds.add(p));
    for (const o of occurrences) if (o.placeId) placeIds.add(o.placeId);
    const editionIds = new Set<string>(
      events
        .map((e) => e.ancestorIds?.[0])
        .filter((id) => id && !events.some((e) => e._id === id)),
    );
    const editions: EventDoc[] = editionIds.size
      ? await this.events.find({ _id: { $in: [...editionIds] } }).lean()
      : [];
    const places: PlaceDoc[] = placeIds.size
      ? await this.places.find({ _id: { $in: [...placeIds] } }).lean()
      : [];
    const seriesIds = [...events, ...editions]
      .map((e) => e.seriesId)
      .filter(Boolean);
    const series: SeriesDoc[] = seriesIds.length
      ? await this.series.find({ _id: { $in: seriesIds } }).lean()
      : [];
    return {
      included: {
        events: Object.fromEntries(
          [...events, ...editions].map((e) => [e._id, eventSummary(e, l)]),
        ),
        places: Object.fromEntries(
          places.map((p) => [p._id, placeSummary(p, l)]),
        ),
        series: Object.fromEntries(
          series.map((s) => [s._id, seriesView(s, l)]),
        ),
      },
      sources: sourcesOf([...events, ...places]),
    };
  }

  async feed(query: FeedQuery) {
    const l = lang(query.lang);
    const from = isDate(query.from) ? query.from : this.today();
    const days = Math.min(Math.max(query.days ?? 30, 1), MAX_FEED_DAYS);
    const windowStart = fromLocal(from);
    const windowEnd = fromLocal(addDays(from, days));

    const candidates: OccurrenceDoc[] = await this.occurrences
      .find({
        ...LIVE,
        starts: { $lt: windowEnd },
        $or: [
          { ends: { $gte: windowStart } },
          { ends: { $exists: false }, starts: { $gte: windowStart } },
        ],
      })
      .sort({ localDate: 1, starts: 1 })
      .lean();
    const events: EventDoc[] = await this.events
      .find({
        _id: { $in: [...new Set(candidates.map((o) => o.eventId))] },
        visibility: 'listed',
        ...LIVE,
      })
      .lean();
    const listed = new Set(events.map((e) => e._id));
    const occurrences = candidates.filter((o) => listed.has(o.eventId));

    const { included, sources } = await this.include(events, occurrences, l);
    const highlights = await this.highlightEntries(l);
    const comingUp = await this.comingUpEntries(365);
    for (const h of highlights.entries)
      included.events[h.eventId] ??= h.summary;
    for (const s of [...highlights.series, ...comingUp.series])
      included.series[s._id] ??= seriesView(s, l);

    return envelope(
      {
        occurrences: occurrences.map(occurrenceView),
        highlights: highlights.entries.map(
          ({ summary: _summary, ...entry }) => entry,
        ),
        comingUp: comingUp.entries,
        notices: [],
      },
      l,
      included,
      sources,
    );
  }

  async highlights(query: { lang?: string }) {
    const l = lang(query.lang);
    const { entries, series } = await this.highlightEntries(l);
    return envelope(
      entries.map(({ summary: _summary, ...entry }) => entry),
      l,
      {
        events: Object.fromEntries(entries.map((e) => [e.eventId, e.summary])),
        series: Object.fromEntries(
          series.map((s) => [s._id, seriesView(s, l)]),
        ),
      },
    );
  }

  /**
   * Each series' current edition, and the hand-picked events in their window.
   *
   * On now first (soonest end), then upcoming (soonest start), then ended
   * (most recent): docs/agenda/api.md, "Highlights".
   */
  private async highlightEntries(l: Lang) {
    const today = this.today();
    const series: SeriesDoc[] = await this.series
      .find({ currentEditionId: { $exists: true } })
      .lean();
    const editionIds = series.map((s) => s.currentEditionId);
    const now = new Date();
    const picked: EventDoc[] = await this.events
      .find({
        'highlight.from': { $lte: now },
        'highlight.to': { $gte: now },
        ...LIVE,
      })
      .lean();
    const editions: EventDoc[] = await this.events
      .find({ _id: { $in: editionIds }, ...LIVE })
      .lean();

    const entries = [
      ...editions,
      ...picked.filter((p) => !editionIds.includes(p._id)),
    ].map((event) => {
      const startDate = event.officialSpan?.startDate ?? event.span?.startDate;
      const endDate = event.officialSpan?.endDate ?? event.span?.endDate;
      const state: 'on' | 'upcoming' | 'ended' =
        startDate > today ? 'upcoming' : endDate < today ? 'ended' : 'on';
      const owner = series.find((s) => s.currentEditionId === event._id);
      return {
        eventId: event._id,
        state,
        label: highlightLabel(state, startDate, endDate, today, l),
        image: event.media?.[0],
        rank: event.highlight?.rank,
        next: state === 'ended' ? owner?.nextExpected : undefined,
        startDate,
        endDate,
        summary: eventSummary(event, l),
      };
    });
    const order = { on: 0, upcoming: 1, ended: 2 };
    entries.sort(
      (a, b) =>
        order[a.state] - order[b.state] ||
        (a.state === 'on'
          ? a.endDate.localeCompare(b.endDate)
          : a.state === 'upcoming'
            ? a.startDate.localeCompare(b.startDate)
            : b.endDate.localeCompare(a.endDate)) ||
        (a.rank ?? 99) - (b.rank ?? 99),
    );
    return { entries, series };
  }

  async comingUp(query: ComingUpQuery) {
    const l = lang(query.lang);
    const { entries, series } = await this.comingUpEntries(
      query.nextWithin ?? 365,
    );
    return envelope(entries, l, {
      series: Object.fromEntries(series.map((s) => [s._id, seriesView(s, l)])),
    });
  }

  private async comingUpEntries(nextWithin: number) {
    const today = this.today();
    const limit = addDays(today, Math.min(Math.max(nextWithin, 1), 730));
    const series: SeriesDoc[] = await this.series
      .find({ 'nextExpected.startDate': { $gt: today, $lte: limit } })
      .sort({ 'nextExpected.startDate': 1 })
      .lean();
    return {
      series,
      entries: series.map((s) => ({
        seriesId: s._id,
        nextExpected: s.nextExpected,
        lastEditionId: s.currentEditionId,
      })),
    };
  }

  private async findEvent(id: string): Promise<EventDoc> {
    const doc: EventDoc = await this.events
      .findOne({ $or: [{ _id: id }, { slug: id }, { slugHistory: id }] })
      .lean();
    if (!doc) throw apiError(404, 'not_found', `No event ${id}`);
    if (doc.status === 'removed') {
      throw apiError(410, 'gone', `Event ${id} was removed`, {
        replacedBy: doc.replacedBy,
      });
    }
    return doc;
  }

  async event(query: EventQuery) {
    const l = lang(query.lang);
    const doc = await this.findEvent(query.id);
    const include = new Set(query.include ?? []);
    const data: Record<string, unknown> = eventDetail(doc, l);
    const related: EventDoc[] = [doc];
    const sessions: OccurrenceDoc[] = [];

    if (include.has('children')) {
      const children: EventDoc[] = await this.events
        .find({ parentId: doc._id, visibility: 'listed', ...LIVE })
        .sort({ 'span.starts': 1 })
        .lean();
      data.children = children.map((c) => eventSummary(c, l));
      related.push(...children);
    }
    if (include.has('occurrences')) {
      const from = fromLocal(addDays(this.today(), -1));
      const occurrences: OccurrenceDoc[] = await this.occurrences
        .find({
          eventId: doc._id,
          ...LIVE,
          $or: [{ ends: { $gte: from } }, { starts: { $gte: from } }],
        })
        .sort({ starts: 1 })
        .limit(500)
        .lean();
      data.occurrences = occurrences.map(occurrenceView);
      sessions.push(...occurrences);
    }
    const { included, sources } = await this.include(related, sessions, l);
    delete included.events[doc._id];
    return envelope(data, l, included, sources);
  }

  /**
   * An edition's or programme's sessions on one day, and how many each day has.
   *
   * Past sessions are included: whether one is over is the client's to work out
   * from its times (docs/agenda/api.md, "Time state").
   */
  async schedule(query: ScheduleQuery) {
    const l = lang(query.lang);
    const root = await this.findEvent(query.id);
    const days = await this.occurrences.aggregate([
      { $match: { ancestorIds: root._id, status: { $ne: 'removed' } } },
      { $group: { _id: '$localDate', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const today = this.today();
    const span = root.span ?? { startDate: today, endDate: today };
    const date = isDate(query.date)
      ? query.date
      : today >= span.startDate && today <= span.endDate
        ? today
        : (days[0]?._id ?? span.startDate);

    const dayStart = fromLocal(date);
    const dayEnd = fromLocal(addDays(date, 1));
    let occurrences: OccurrenceDoc[] = await this.occurrences
      .find({
        ancestorIds: root._id,
        ...LIVE,
        $or: [
          { localDate: date },
          { kind: 'run', starts: { $lt: dayEnd }, ends: { $gt: dayStart } },
        ],
      })
      .sort({ starts: 1 })
      .lean();
    let events: EventDoc[] = await this.events
      .find({
        _id: { $in: [...new Set(occurrences.map((o) => o.eventId))] },
        visibility: 'listed',
        ...LIVE,
      })
      .lean();
    if (query.kinds?.length) {
      events = events.filter((e) =>
        e.kinds.some((k) =>
          query.kinds.some((q) => k === q || k.startsWith(`${q}.`)),
        ),
      );
    }
    if (query.pricing)
      events = events.filter((e) => e.pricing === query.pricing);
    if (query.placeId)
      events = events.filter((e) => e.placeIds.includes(query.placeId));
    const kept = new Set(events.map((e) => e._id));
    occurrences = occurrences.filter((o) => kept.has(o.eventId));

    const { included, sources } = await this.include(events, occurrences, l);
    return envelope(
      {
        date,
        days: days.map((d) => ({ localDate: d._id, count: d.count })),
        occurrences: occurrences.map(occurrenceView),
      },
      l,
      included,
      sources,
    );
  }

  async placesList(query: PlacesQuery) {
    const l = lang(query.lang);
    const filter: Record<string, unknown> = { ...LIVE };
    if (query.kinds?.length) {
      filter.kinds = {
        $in: query.kinds.flatMap((k) => [
          k,
          new RegExp(`^${k.replace(/\./g, '\\.')}\\.`),
        ]),
      };
    }
    const limit = Math.min(query.limit ?? 50, 200);
    let places: PlaceDoc[];
    if (query.near) {
      places = await this.places
        .find({
          ...filter,
          geo: {
            $nearSphere: {
              $geometry: { type: 'Point', coordinates: query.near },
              $maxDistance: Math.min(query.radius ?? 2000, 20000),
            },
          },
        })
        .limit(limit)
        .lean();
    } else {
      places = await this.places
        .find(filter)
        .sort({ 'name.es': 1 })
        .limit(limit)
        .lean();
    }
    return envelope(
      places.map((p) => placeSummary(p, l)),
      l,
      {},
      sourcesOf(places),
    );
  }

  async place(query: PlaceQuery) {
    const l = lang(query.lang);
    const doc: PlaceDoc = await this.places
      .findOne({
        $or: [{ _id: query.id }, { slug: query.id }, { slugHistory: query.id }],
      })
      .lean();
    if (!doc) throw apiError(404, 'not_found', `No place ${query.id}`);
    if (doc.status === 'removed') {
      throw apiError(410, 'gone', `Place ${query.id} was removed`, {
        replacedBy: doc.replacedBy,
      });
    }
    const data: Record<string, unknown> = placeDetail(doc, l);
    let events: EventDoc[] = [];
    let occurrences: OccurrenceDoc[] = [];
    if ((query.include ?? []).includes('happening')) {
      const today = this.today();
      const from = fromLocal(today);
      const to = fromLocal(addDays(today, 30));
      events = await this.events
        .find({ placeIds: doc._id, visibility: 'listed', ...LIVE })
        .lean();
      const ids = events.map((e) => e._id);
      occurrences = await this.occurrences
        .find({
          ...LIVE,
          $and: [
            { $or: [{ eventId: { $in: ids } }, { placeId: doc._id }] },
            { starts: { $lt: to } },
            {
              $or: [
                { ends: { $gte: from } },
                { ends: { $exists: false }, starts: { $gte: from } },
              ],
            },
          ],
        })
        .sort({ starts: 1 })
        .limit(300)
        .lean();
      data.happening = occurrences.map(occurrenceView);
    }
    const { included, sources } = await this.include(events, occurrences, l);
    delete included.places[doc._id];
    return envelope(
      data,
      l,
      included,
      new Set([...sources, ...sourcesOf([doc])]),
    );
  }

  async seriesOne(query: { id: string; lang?: string }) {
    const l = lang(query.lang);
    const doc: SeriesDoc = await this.series
      .findOne({
        $or: [{ _id: query.id }, { slug: query.id }, { slugHistory: query.id }],
      })
      .lean();
    if (!doc) throw apiError(404, 'not_found', `No series ${query.id}`);
    const current: EventDoc[] = doc.currentEditionId
      ? await this.events.find({ _id: doc.currentEditionId }).lean()
      : [];
    return envelope(seriesView(doc, l), l, {
      events: Object.fromEntries(
        current.map((e) => [e._id, eventSummary(e, l)]),
      ),
    });
  }

  taxonomy(query: { lang?: string }) {
    const l = lang(query.lang);
    const view = (entries: typeof KINDS) =>
      entries.map((e) => ({
        code: e.code,
        parent: e.code.includes('.')
          ? e.code.slice(0, e.code.lastIndexOf('.'))
          : undefined,
        label: e.label[l],
        icon: e.icon,
        deprecated: e.deprecated,
        replacedBy: e.replacedBy,
      }));
    return envelope(
      {
        kinds: view(KINDS),
        placeKinds: view(PLACE_KINDS),
        noticeKinds: view(NOTICE_KINDS),
      },
      l,
    );
  }

  /**
   * Series, events and places matching a query, as search hits: scored by
   * `searchAgenda` over the whole agenda held in memory. A few thousand
   * records score in milliseconds, which lets every word allow a slip and
   * leaves no candidate cut before it is scored.
   */
  async search(query: AgendaSearchQuery): Promise<SearchHit[]> {
    const q = (query.q ?? '').slice(0, SEARCH_MAX_QUERY);
    if (!searchable(q)) return [];
    const types = new Set(query.types ?? []);
    const wants = (type: SearchHitType) => types.size === 0 || types.has(type);
    const hits = searchAgenda(
      await this.searchIndex(),
      q,
      wants,
      lang(query.lang),
      this.today(),
    );
    return rankHits(hits, Math.min(query.limit ?? 30, MAX_SEARCH_HITS));
  }

  private index?: { at: number; loading: Promise<AgendaIndex> };

  /** The agenda as a search reads it, read again once it is ten minutes old. */
  private searchIndex(): Promise<AgendaIndex> {
    const now = Date.now();
    if (!this.index || now - this.index.at > SEARCH_INDEX_TTL_MS) {
      const loading = this.loadSearchIndex();
      this.index = { at: now, loading };
      // A failed read is not kept: the next search tries again.
      loading.catch(() => {
        if (this.index?.loading === loading) this.index = undefined;
      });
    }
    return this.index.loading;
  }

  private async loadSearchIndex(): Promise<AgendaIndex> {
    const today = this.today();
    const [series, events, places] = await Promise.all([
      this.series.find({}).lean<SeriesDoc[]>(),
      this.events
        .find({
          visibility: { $in: ['listed', 'searchable'] },
          ...LIVE,
          $or: [
            { type: 'edition' },
            { 'span.ends': { $gte: fromLocal(addDays(today, -30)) } },
          ],
        })
        .lean<EventDoc[]>(),
      this.places.find(LIVE).lean<PlaceDoc[]>(),
    ]);
    return {
      series,
      events,
      places: new Map(places.map((p) => [p._id, p])),
    };
  }
}
