import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { foldText } from '@canopus/shared';
import { newId, slugify } from '../model/ids';
import { addDays, fromLocal, localDate } from '../model/time';
import { EventDoc, FacetSource, OccurrenceDoc, PlaceDoc } from '../model/types';
import {
  EventCandidate,
  OccurrenceCandidate,
  PlaceCandidate,
} from '../city/normalise';
import { EVENT, OCCURRENCE, PLACE } from '../schemas/schemas';
import { Identities, IdentityMap } from './identities';

/** Within this distance two places of the same name are the same place. */
const SAME_PLACE_METRES = 200;

const metres = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
};

const hashOf = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface EditionLink {
  id: string;
  ancestorIds: string[];
  programmes: Set<string>;
  portals: Set<string>;
  from: string;
  to: string;
}

/**
 * An editorial correction, resolved to ids, for one record of a source.
 *
 * Applied while the record is published, never after it: a correction made
 * once holds through every re-import, and the record is written once a run.
 */
export interface ResolvedOverride {
  key: string;
  parent?: { id: string; ancestorIds: string[] };
  fields: Partial<{
    title: { es?: string; en?: string };
    kinds: string[];
    visibility: 'listed' | 'searchable' | 'hidden';
    media: { url: string }[];
    offers: unknown[];
    pricing: string;
  }>;
  status?: 'scheduled' | 'postponed' | 'cancelled';
  statusNote?: { es?: string; en?: string };
  facet: FacetSource;
}

/** Bulk writes, a thousand at a time, unordered: one round trip each. */
const writeInBatches = async (model: Model<any>, ops: any[]) => {
  for (let i = 0; i < ops.length; i += 1000) {
    await model.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  }
};

/** From the first session's start to the last one's end, from sessions in hand. */
export const spanFromList = (list: OccurrenceDoc[]) => {
  const live = list.filter((o) => o.status !== 'removed');
  if (live.length === 0) return undefined;
  let starts = new Date(live[0].starts);
  let ends = new Date(live[0].ends ?? live[0].starts);
  for (const o of live) {
    if (+new Date(o.starts) < +starts) starts = new Date(o.starts);
    const end = new Date(o.ends ?? o.starts);
    if (+end > +ends) ends = end;
  }
  return {
    starts,
    ends,
    startDate: localDate(starts),
    endDate: localDate(new Date(+ends - 1)),
  };
};

export interface PublishCounts {
  events: { created: number; updated: number; unchanged: number };
  places: { created: number; updated: number };
  occurrences: { created: number; updated: number; removed: number };
  linked: number;
}

/**
 * Candidates from a source into the published collections.
 *
 * Only what changed is written, and every write raises `version`
 * (docs/agenda/ingestion.md, "Publish"). Nothing is deleted: a session the
 * source no longer lists, inside the window it was regenerated for, becomes
 * `removed`; one on the same day at another time is recorded as a move, so a
 * reader sees "moved from 20:00 to 21:00" rather than a session vanishing.
 */
@Injectable()
export class Publisher {
  private readonly logger = new Logger(Publisher.name);

  constructor(
    private readonly identities: Identities,
    @InjectModel(EVENT) private readonly events: Model<any>,
    @InjectModel(OCCURRENCE) private readonly occurrences: Model<any>,
    @InjectModel(PLACE) private readonly places: Model<any>,
  ) {}

  async publishPlaces(
    source: string,
    candidates: PlaceCandidate[],
    now: Date,
  ): Promise<{ map: IdentityMap; created: number; updated: number }> {
    const map = await this.identities.load(source, 'places');
    await this.adoptOrphans(source, map, this.places);
    const all: PlaceDoc[] = await this.places.find({}).lean();
    const byId = new Map(all.map((p) => [p._id, p]));
    let created = 0;
    let updated = 0;

    const unique = new Map<string, PlaceCandidate>();
    for (const c of candidates) if (!unique.has(c.ref)) unique.set(c.ref, c);

    for (const candidate of unique.values()) {
      let id = map.get(candidate.ref);
      if (!id) {
        // Another source may have it already, under the same name nearby.
        const name = foldText(candidate.name);
        const match = all.find(
          (p) =>
            p.status !== 'removed' &&
            (foldText(p.name.es ?? '') === name ||
              p.aliases.some((a) => foldText(a) === name)) &&
            (!p.geo ||
              !candidate.coordinates ||
              metres(p.geo.coordinates, candidate.coordinates) <
                SAME_PLACE_METRES),
        );
        id = map.resolve(
          candidate.ref,
          match ? 'matched' : 'exact',
          match?._id,
        );
        // Saved before the place is: a run cut short must not leave a place
        // the next run cannot recognise as its own.
        await map.flush();
      }
      const existing = byId.get(id);
      const provenance: FacetSource = {
        source,
        ref: candidate.ref,
        observedAt: now,
        confidence: 'official',
      };
      const fields = {
        type: candidate.type,
        kinds:
          existing?.kinds?.length && existing.kinds[0] !== 'venue'
            ? existing.kinds
            : candidate.kinds,
        name: existing?.name ?? { es: candidate.name },
        aliases: [...new Set([...(existing?.aliases ?? []), candidate.name])],
        geo: candidate.coordinates
          ? { type: 'Point' as const, coordinates: candidate.coordinates }
          : existing?.geo,
        address: {
          street: candidate.street ?? existing?.address?.street,
          postalCode: candidate.postalCode ?? existing?.address?.postalCode,
          locality: 'Zaragoza',
          district: candidate.district ?? existing?.address?.district,
        },
        hoursText: candidate.hoursText ?? existing?.hoursText,
        contact: {
          phone: candidate.phone ?? existing?.contact?.phone,
          email: candidate.email ?? existing?.contact?.email,
          website: candidate.website ?? existing?.contact?.website,
        },
        admission: candidate.admissionText
          ? { note: { es: candidate.admissionText } }
          : existing?.admission,
      };
      const searchText = foldText(
        [fields.name.es, ...fields.aliases, fields.address.street].join(' '),
      );
      const contentHash = hashOf(fields);
      if (existing && (existing as any).contentHash === contentHash) continue;
      if (existing) {
        await this.places.updateOne(
          { _id: id },
          {
            $set: {
              ...fields,
              searchText,
              contentHash,
              [`provenance.place`]: provenance,
            },
            $inc: { version: 1 },
          },
        );
        updated++;
      } else {
        const doc = {
          _id: id,
          slug: `${slugify(candidate.name)}-${id.slice(-6).toLowerCase()}`,
          slugHistory: [],
          ...fields,
          parentId: undefined,
          ancestorIds: [],
          links: [],
          media: [],
          status: 'open',
          searchText,
          contentHash,
          provenance: { identity: provenance, place: provenance },
          version: 1,
        };
        await this.places.create(doc);
        all.push(doc as PlaceDoc);
        byId.set(id, doc as PlaceDoc);
        created++;
      }
    }
    await map.flush();
    return { map, created, updated };
  }

  async publishEvents(
    source: string,
    candidates: EventCandidate[],
    editions: EditionLink[],
    today: string,
    now: Date,
    overrides: Map<string, ResolvedOverride> = new Map(),
  ): Promise<PublishCounts> {
    const counts: PublishCounts = {
      events: { created: 0, updated: 0, unchanged: 0 },
      places: { created: 0, updated: 0 },
      occurrences: { created: 0, updated: 0, removed: 0 },
      linked: 0,
    };

    const placeResult = await this.publishPlaces(
      source,
      candidates.flatMap((c) => c.places),
      now,
    );
    counts.places = {
      created: placeResult.created,
      updated: placeResult.updated,
    };
    const placeIds = placeResult.map;
    const placeNames = new Map<string, string>(
      (await this.places.find({}, { name: 1 }).lean()).map((p: any) => [
        p._id,
        p.name?.es ?? '',
      ]),
    );

    const eventIds = await this.identities.load(source, 'events');
    await this.adoptOrphans(source, eventIds, this.events);
    // Every id this run will write is saved before anything is written with
    // it, so a run cut short (a deploy, a restart) leaves nothing the next one
    // would mistake for new and publish twice.
    for (const candidate of candidates) eventIds.resolve(candidate.ref);
    await eventIds.flush();

    const confirmed: string[] = [];
    const existingEvents = new Map<string, EventDoc & { contentHash?: string }>(
      (
        await this.events.find({ 'provenance.identity.source': source }).lean()
      ).map((e: any) => [e._id, e]),
    );
    // One query and batched writes rather than a round trip per session: the
    // first import is some 24,000 sessions, which is minutes of latency
    // against a database across a network.
    const existingOccurrences = new Map<string, OccurrenceDoc[]>();
    for (const o of (await this.occurrences
      .find({ eventId: { $in: candidates.map((c) => eventIds.get(c.ref)) } })
      .lean()) as OccurrenceDoc[]) {
      const list = existingOccurrences.get(o.eventId) ?? [];
      list.push(o);
      existingOccurrences.set(o.eventId, list);
    }
    const occurrenceOps: any[] = [];
    const eventOps: any[] = [];

    for (const candidate of candidates) {
      const id = eventIds.get(candidate.ref);
      const existing = existingEvents.get(id);
      const override = overrides.get(candidate.ref);
      // Within the edition, give or take its margin, and not merely overlapping
      // it: museums tag year-long exhibitions with the fiestas' portal, and an
      // exhibition that runs from April to August is not part of the Pilar.
      const linked = editions.find(
        (e) =>
          (candidate.programmes.some((p) => e.programmes.has(foldText(p))) ||
            candidate.portals.some((p) => e.portals.has(foldText(p)))) &&
          candidate.startDate >= e.from &&
          candidate.endDate <= e.to,
      );
      const edition = override?.parent ?? linked;
      if (edition) counts.linked++;
      const ancestorIds = edition ? [...edition.ancestorIds, edition.id] : [];
      const places = candidate.places
        .map((p) => placeIds.get(p.ref))
        .filter(Boolean) as string[];

      const occurrenceResult = this.planOccurrences(
        existingOccurrences.get(id) ?? [],
        id,
        ancestorIds,
        candidate.occurrences,
        (ref) => (ref ? placeIds.get(ref) : undefined),
        places[0],
        source,
        candidate.ref,
        now,
        addDays(today, -7),
      );
      occurrenceOps.push(...occurrenceResult.ops);
      counts.occurrences.created += occurrenceResult.created;
      counts.occurrences.updated += occurrenceResult.updated;
      counts.occurrences.removed += occurrenceResult.removed;

      const span = spanFromList(occurrenceResult.live) ?? {
        starts: fromLocal(candidate.startDate),
        ends: fromLocal(addDays(candidate.endDate, 1)),
        startDate: candidate.startDate,
        endDate: candidate.endDate,
      };
      const facet: FacetSource = {
        source,
        ref: candidate.ref,
        observedAt: now,
        confidence: 'official',
        url: `https://www.zaragoza.es/sede/servicio/cultura/evento/${candidate.ref}`,
      };
      const fields = {
        type: 'activity' as const,
        parentId: edition?.id,
        ancestorIds,
        title: { es: candidate.title },
        description: candidate.description
          ? { es: candidate.description }
          : undefined,
        summary: candidate.description
          ? { es: candidate.description.split('\n')[0].slice(0, 280) }
          : undefined,
        textLang: 'es',
        kinds: candidate.kinds,
        categoryAsPublished: candidate.categoryAsPublished,
        tags: candidate.tags,
        audience: candidate.audience,
        placeIds: places,
        where: candidate.where ? { es: candidate.where } : undefined,
        span,
        offers: candidate.offers.map((o) => ({ ...o, provenance: facet })),
        pricing: candidate.pricing,
        links: candidate.links,
        media: candidate.image ? [{ url: candidate.image }] : [],
        visibility: candidate.visibility,
        visibilityRule: candidate.visibilityRule,
        ...(override?.fields ?? {}),
        ...(override?.fields.visibility
          ? { visibilityRule: `override:${override.key}` }
          : {}),
        statusNote: override?.statusNote,
        overriddenBy: override?.key,
      };
      const searchText = foldText(
        [
          candidate.title,
          ...candidate.tags,
          ...places.map((p) => placeNames.get(p) ?? ''),
          candidate.where,
        ]
          .filter(Boolean)
          .join(' '),
      );
      // The offers' provenance says when they were last seen, which is every run:
      // compared without it, or every event with a price would be rewritten daily.
      const contentHash = hashOf({
        ...fields,
        // Without provenance on either side: it carries when it was last seen.
        offers: (override?.fields.offers ?? candidate.offers).map(
          ({ provenance: _seen, ...offer }: { provenance?: unknown }) => offer,
        ),
        overrideStatus: override?.status,
      });
      const provenance = {
        identity: facet,
        schedule: facet,
        place: facet,
        pricing: override?.fields.offers ? override.facet : facet,
        text: override?.fields.title ? override.facet : facet,
        media: override?.fields.media ? override.facet : facet,
        classification:
          override?.fields.kinds || override?.parent
            ? override.facet
            : { ...facet, confidence: 'inferred' as const },
      };

      if (
        existing &&
        existing.contentHash === contentHash &&
        !occurrenceResult.changes.length
      ) {
        counts.events.unchanged++;
        confirmed.push(id);
        continue;
      }
      if (existing) {
        const changes = [
          ...occurrenceResult.changes,
          ...(existing.changes ?? []),
        ].slice(0, 20);
        const status =
          override?.status ??
          (existing.status === 'removed'
            ? existing.status
            : occurrenceResult.changes.length
              ? 'changed'
              : existing.status === 'cancelled' && existing.overriddenBy
                ? 'scheduled'
                : existing.status);
        eventOps.push({
          updateOne: {
            filter: { _id: id },
            update: {
              $set: {
                ...fields,
                searchText,
                contentHash,
                provenance,
                changes,
                status,
              },
              $inc: { version: 1 },
            },
          },
        });
        counts.events.updated++;
      } else {
        eventOps.push({
          insertOne: {
            document: {
              _id: id,
              slug: `${slugify(candidate.title)}-${id.slice(-6).toLowerCase()}`,
              slugHistory: [],
              ...fields,
              status: override?.status ?? 'scheduled',
              changes: [],
              searchText,
              contentHash,
              provenance,
              version: 1,
            },
          },
        });
        counts.events.created++;
      }
    }
    await writeInBatches(this.occurrences, occurrenceOps);
    await writeInBatches(this.events, eventOps);
    // Unchanged is still seen: the source said the same thing again today,
    // which is what a reader's "checked" time is meant to say.
    if (confirmed.length > 0) {
      const facets = [
        'identity',
        'schedule',
        'place',
        'pricing',
        'text',
        'media',
        'classification',
      ];
      await this.events.updateMany(
        { _id: { $in: confirmed } },
        {
          $set: Object.fromEntries(
            facets.map((f) => [`provenance.${f}.observedAt`, now]),
          ),
        },
      );
    }
    return counts;
  }

  async publishOccurrences(
    eventId: string,
    ancestorIds: string[],
    candidates: OccurrenceCandidate[],
    placeOf: (ref?: string) => string | undefined,
    primaryPlace: string | undefined,
    source: string,
    ref: string,
    today: string,
    now: Date,
    // From which local date a session the source no longer lists is removed.
    // A feed's window by default; everything, for editorial data, where a
    // session taken out was taken out on purpose.
    removeFrom = addDays(today, -7),
  ) {
    const existing: OccurrenceDoc[] = await this.occurrences
      .find({ eventId })
      .lean();
    const plan = this.planOccurrences(
      existing,
      eventId,
      ancestorIds,
      candidates,
      placeOf,
      primaryPlace,
      source,
      ref,
      now,
      removeFrom,
    );
    await writeInBatches(this.occurrences, plan.ops);
    return plan;
  }

  /** What to write for one event's sessions, against what is stored. Writes nothing. */
  planOccurrences(
    existing: OccurrenceDoc[],
    eventId: string,
    ancestorIds: string[],
    candidates: OccurrenceCandidate[],
    placeOf: (ref?: string) => string | undefined,
    primaryPlace: string | undefined,
    source: string,
    ref: string,
    now: Date,
    removeFrom: string,
  ) {
    const ops: any[] = [];
    const live: OccurrenceDoc[] = [];
    const byKey = new Map(existing.map((o) => [o.sourceKey, o]));
    const facet: FacetSource = {
      source,
      ref,
      observedAt: now,
      confidence: 'official',
    };
    let created = 0;
    let updated = 0;
    const added: OccurrenceDoc[] = [];
    const seen = new Set<string>();

    // The city lists some sessions twice with different end times, in a
    // different order on every fetch: the latest-ending copy wins, so the
    // choice is the same every run and the two never overwrite each other.
    const unique = new Map<string, OccurrenceCandidate>();
    for (const c of candidates) {
      const kept = unique.get(c.sourceKey);
      if (
        !kept ||
        +(c.ends ?? 0) > +(kept.ends ?? 0) ||
        (+(c.ends ?? 0) === +(kept.ends ?? 0) &&
          JSON.stringify(c) > JSON.stringify(kept))
      ) {
        unique.set(c.sourceKey, c);
      }
    }
    for (const c of unique.values()) {
      seen.add(c.sourceKey);
      const placeId = placeOf(c.placeRef);
      const fields = {
        eventId,
        ancestorIds: [...ancestorIds, eventId],
        placeId: placeId && placeId !== primaryPlace ? placeId : undefined,
        kind: c.kind,
        starts: c.starts,
        ends: c.ends,
        precision: c.precision,
        every: c.every,
        hours: c.hours?.length ? c.hours : undefined,
        localDate: c.localDate,
        localTime: c.localTime,
        localEndDate: c.localEndDate,
        localEndTime: c.localEndTime,
        status: 'scheduled' as const,
      };
      const before = byKey.get(c.sourceKey);
      if (!before) {
        // No identity row: an occurrence is its event's id and its sourceKey,
        // which the unique index already holds.
        const id = newId('occurrence');
        const doc = {
          _id: id,
          ...fields,
          sourceKey: c.sourceKey,
          provenance: { schedule: facet },
          version: 1,
        };
        ops.push({
          updateOne: {
            filter: { eventId, sourceKey: c.sourceKey },
            update: { $setOnInsert: doc },
            upsert: true,
          },
        });
        added.push(doc as OccurrenceDoc);
        live.push(doc as OccurrenceDoc);
        created++;
        continue;
      }
      live.push({ ...before, ...fields } as OccurrenceDoc);
      if (
        before.status === 'removed' ||
        +new Date(before.starts) !== +c.starts ||
        +new Date(before.ends ?? 0) !== +(c.ends ?? 0) ||
        before.kind !== c.kind ||
        before.precision !== c.precision ||
        before.every !== c.every ||
        JSON.stringify(before.hours ?? null) !==
          JSON.stringify(fields.hours ?? null) ||
        before.placeId !== fields.placeId ||
        JSON.stringify(before.ancestorIds) !==
          JSON.stringify(fields.ancestorIds)
      ) {
        ops.push({
          updateOne: {
            filter: { _id: before._id },
            update: {
              $set: { ...fields, 'provenance.schedule': facet },
              $inc: { version: 1 },
            },
          },
        });
        updated++;
      }
    }

    // Only inside the window this run regenerated: older sessions were made by
    // earlier runs from a feed that no longer lists them, and are the archive.
    const removed = existing.filter(
      (o) =>
        !seen.has(o.sourceKey) &&
        o.status !== 'removed' &&
        o.localDate >= removeFrom,
    );
    if (removed.length > 0) {
      ops.push({
        updateMany: {
          filter: { _id: { $in: removed.map((o) => o._id) } },
          update: { $set: { status: 'removed' }, $inc: { version: 1 } },
        },
      });
    }
    const removedIds = new Set(removed.map((o) => o._id));
    // Older sessions kept as archive still count towards the event's span.
    for (const o of existing) {
      if (
        !seen.has(o.sourceKey) &&
        o.status !== 'removed' &&
        !removedIds.has(o._id)
      )
        live.push(o);
    }

    const changes = [];
    for (const gone of removed) {
      const replacement = added.find(
        (a) => a.localDate === gone.localDate && a.kind === 'session',
      );
      if (
        gone.kind === 'session' &&
        replacement &&
        gone.localTime &&
        replacement.localTime
      ) {
        changes.push({
          at: now,
          facet: 'schedule' as const,
          summary: {
            es: `${gone.localDate}: de las ${gone.localTime} a las ${replacement.localTime}`,
            en: `${gone.localDate}: moved from ${gone.localTime} to ${replacement.localTime}`,
          },
          occurrenceId: replacement._id,
        });
      }
    }
    return { ops, live, created, updated, removed: removed.length, changes };
  }

  /**
   * Records of a source published without their identity saved: what a run
   * cut short between the two used to leave. Each ref keeps its oldest
   * record; any later copy becomes `removed`, pointing at it.
   */
  private async adoptOrphans(
    source: string,
    map: IdentityMap,
    model: Model<any>,
  ) {
    const docs = await model
      .find(
        { 'provenance.identity.source': source, status: { $ne: 'removed' } },
        { 'provenance.identity.ref': 1, createdAt: 1 },
      )
      .sort({ createdAt: 1 })
      .lean();
    const duplicates: { id: string; keep: string }[] = [];
    for (const doc of docs as any[]) {
      const ref = doc.provenance?.identity?.ref;
      if (!ref) continue;
      const known = map.get(ref);
      if (!known) map.resolve(ref, 'exact', doc._id);
      else if (known !== doc._id) duplicates.push({ id: doc._id, keep: known });
    }
    await map.flush();
    for (const { id, keep } of duplicates) {
      await model.updateOne(
        { _id: id },
        {
          $set: { status: 'removed', visibility: 'hidden', replacedBy: keep },
          $inc: { version: 1 },
        },
      );
      if (model === this.events) {
        await this.occurrences.updateMany(
          { eventId: id },
          { $set: { status: 'removed' } },
        );
      }
    }
    if (duplicates.length > 0) {
      this.logger.warn(
        `${source}: ${duplicates.length} duplicate records retired`,
      );
    }
  }

  /** From the first session's start to the last one's end. */
  async spanOf(eventIdOrAncestor: string, ancestor = false) {
    const filter = ancestor
      ? { ancestorIds: eventIdOrAncestor, status: { $ne: 'removed' } }
      : { eventId: eventIdOrAncestor, status: { $ne: 'removed' } };
    const [first] = await this.occurrences
      .find(filter, { starts: 1 })
      .sort({ starts: 1 })
      .limit(1)
      .lean();
    const [last] = await this.occurrences
      .find(filter, { starts: 1, ends: 1 })
      .sort({ ends: -1, starts: -1 })
      .limit(1)
      .lean();
    if (!first || !last) return undefined;
    const ends: Date = (last as any).ends ?? (last as any).starts;
    return {
      starts: (first as any).starts as Date,
      ends,
      startDate: localDate((first as any).starts),
      endDate: localDate(new Date(+ends - 1)),
    };
  }
}
