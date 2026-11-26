import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { fetchWithTimeout } from '@canopus/nest';
import { RAW_RECORD } from '../schemas/schemas';
import { CityEvent, CityFacility, CityMonument } from './city-record';
import {
  FACILITIES_SOURCE,
  MONUMENTS_SOURCE,
  NIGHTLIFE_SOURCE,
  SOURCE,
  todayInCity,
} from './normalise';

const BASE = 'https://www.zaragoza.es/sede/servicio';

/** The city answers 500 rows a page however many are asked for. */
const PAGE = 500;

/**
 * Fetches the city's agenda, museums and monuments, and keeps every record as received.
 *
 * The archive is the point (docs/agenda/ingestion.md, "Raw first"): the city
 * deletes an event's record once it is over, so whatever is not stored here
 * the day it is published is gone. Nothing in `raw_records` is ever deleted;
 * a record that stops appearing only gets `goneAt`.
 *
 * Paging is sorted by id. Unsorted, the city's pages overlap and skip: 500 at
 * a time returned 2,289 different events of the 2,967 it claimed
 * (docs/agenda/research.md).
 */
@Injectable()
export class CitySource {
  private readonly logger = new Logger(CitySource.name);

  constructor(
    private readonly http: HttpService,
    @InjectModel(RAW_RECORD) private readonly raw: Model<any>,
  ) {}

  async fetchEvents(today = todayInCity()): Promise<CityEvent[]> {
    const query = `q=endDate=ge=${today}T00:00:00Z&sort=id%20asc&srsname=wgs84`;
    return this.fetchAll<CityEvent>(
      `${BASE}/cultura/evento/list.json?${query}`,
    );
  }

  async fetchMuseums(): Promise<CityFacility[]> {
    const query = 'q=category.title==Museos&sort=id%20asc&srsname=wgs84';
    return this.fetchAll<CityFacility>(
      `${BASE}/equipamiento/list.json?${query}`,
    );
  }

  /**
   * Music halls and clubs, from which `DISCOS` picks: *Salas de Música* and
   * the venues that signed the city's protocol against sexist aggression.
   * By category id, since one title carries an accent and another a double
   * space that a query has to match exactly.
   */
  async fetchNightlife(): Promise<CityFacility[]> {
    const of = (id: number) =>
      this.fetchAll<CityFacility>(
        `${BASE}/equipamiento/list.json?q=category.id==${id}&sort=id%20asc&srsname=wgs84`,
      );
    return [...(await of(880)), ...(await of(1960))];
  }

  async fetchMonuments(): Promise<CityMonument[]> {
    return this.fetchAll<CityMonument>(
      `${BASE}/monumento/list.json?sort=id%20asc&srsname=wgs84`,
    );
  }

  private async fetchAll<T extends { id: number | string }>(
    url: string,
  ): Promise<T[]> {
    const byId = new Map<string, T>();
    let total = Infinity;
    for (let start = 0; start < total; start += PAGE) {
      const page = await fetchWithTimeout<{
        totalCount?: number;
        result?: T[];
      }>(this.http, `${url}&rows=${PAGE}&start=${start}`, { timeoutMs: 60000 });
      total = page.totalCount ?? 0;
      for (const record of page.result ?? [])
        byId.set(String(record.id), record);
      if (!page.result?.length) break;
    }
    if (byId.size < total) {
      this.logger.warn(
        `${url}: ${byId.size} records of the ${total} the city counts`,
      );
    }
    return [...byId.values()];
  }

  /**
   * Stores what was fetched, and says which records changed.
   *
   * A record whose hash is unchanged is touched (`lastSeenAt`) and not
   * reprocessed. Records of this source not seen in this fetch get `goneAt`,
   * once: they are over, or the city withdrew them.
   */
  async archive(
    source:
      | typeof SOURCE
      | typeof FACILITIES_SOURCE
      | typeof MONUMENTS_SOURCE
      | typeof NIGHTLIFE_SOURCE,
    records: { id: number | string }[],
    now = new Date(),
  ): Promise<{
    changed: Set<string>;
    created: number;
    unchanged: number;
    gone: number;
    /** Records that stopped appearing in this fetch, with what they last said. */
    newlyGone: { ref: string; payload: any }[];
    /** Records that had stopped appearing and are back. */
    returned: string[];
  }> {
    const stored = await this.raw
      .find({ source }, { ref: 1, hash: 1, goneAt: 1 })
      .lean();
    const existing = new Map<string, string>(
      stored.map((r: any) => [r.ref, r.hash]),
    );
    const wasGone = new Set(
      stored.filter((r: any) => r.goneAt).map((r: any) => r.ref as string),
    );
    const changed = new Set<string>();
    let created = 0;
    const operations = [];
    for (const record of records) {
      const ref = String(record.id);
      const hash = createHash('sha256')
        .update(JSON.stringify(record))
        .digest('hex');
      const before = existing.get(ref);
      if (before === undefined) created++;
      if (before !== hash) changed.add(ref);
      operations.push({
        updateOne: {
          filter: { source, ref },
          update:
            before === hash
              ? { $set: { lastSeenAt: now }, $unset: { goneAt: '' } }
              : {
                  $set: { payload: record, hash, lastSeenAt: now },
                  $setOnInsert: { firstSeenAt: now },
                  $unset: { goneAt: '' },
                },
          upsert: true,
        },
      });
    }
    for (let i = 0; i < operations.length; i += 500) {
      await this.raw.bulkWrite(operations.slice(i, i + 500), {
        ordered: false,
      });
    }
    const seen = new Set(records.map((r) => String(r.id)));
    const goneRefs = [...existing.keys()].filter((ref) => !seen.has(ref));
    const newlyGone = goneRefs.length
      ? (
          await this.raw
            .find(
              { source, ref: { $in: goneRefs }, goneAt: { $exists: false } },
              { ref: 1, payload: 1 },
            )
            .lean()
        ).map((r: any) => ({ ref: r.ref as string, payload: r.payload }))
      : [];
    if (goneRefs.length > 0) {
      await this.raw.updateMany(
        { source, ref: { $in: goneRefs }, goneAt: { $exists: false } },
        { $set: { goneAt: now } },
      );
    }
    return {
      changed,
      created,
      unchanged: records.length - changed.size,
      gone: goneRefs.length,
      newlyGone,
      returned: [...seen].filter((ref) => wasGone.has(ref)),
    };
  }

  /** Every stored record of a source, for a replay after a rule changes. */
  async stored<T>(source: string, currentOnly = false): Promise<T[]> {
    const filter: Record<string, unknown> = { source };
    if (currentOnly) filter.goneAt = { $exists: false };
    return (await this.raw.find(filter, { payload: 1 }).lean()).map(
      (r: any) => r.payload as T,
    );
  }
}
