import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of, tap } from 'rxjs';

/**
 * How long what a route answers stays true, which says how long a client may
 * keep it and how long the gateway keeps it itself.
 *
 * - `static`: stops, docks and lines, places, an event's or a series' page.
 *   Changes at an import or a timetable change, days apart.
 * - `daily`: what is on (the feed, highlights, a day's schedule), the
 *   billboard, the duty chemists. Changes through a day.
 * - `alerts`: service alerts, which are news.
 * - `live`: one stop's arrivals, one dock's bikes, the taxis. The services
 *   already hold these ten to thirty seconds; the gateway keeps none.
 * - `none`: what acts or must never be reused, the `update` routes.
 */
export type CacheKind = 'static' | 'daily' | 'alerts' | 'live' | 'none';

interface Policy {
  /** What the response tells a client and anything between it and us. */
  header: string;
  /** How long the gateway answers the same URL from memory, without asking the service. */
  keepMs: number;
}

export const POLICIES: Record<CacheKind, Policy> = {
  static: {
    header: 'public, max-age=3600, stale-while-revalidate=86400',
    keepMs: 10 * 60_000,
  },
  daily: {
    header: 'public, max-age=600, stale-while-revalidate=3600',
    keepMs: 2 * 60_000,
  },
  alerts: {
    header: 'public, max-age=120, stale-while-revalidate=600',
    keepMs: 30_000,
  },
  live: { header: 'public, max-age=10', keepMs: 0 },
  none: { header: 'no-store', keepMs: 0 },
};

const CACHE_KIND = 'cacheKind';

/** Says how long what this route answers stays true; see `CacheKind`. */
export const CachePolicy = (kind: CacheKind) => SetMetadata(CACHE_KIND, kind);

/** How many answers the gateway keeps; the least recently used goes first. */
const KEPT_ENTRIES = 300;

interface Kept {
  at: number;
  body: unknown;
}

/**
 * Stamps a route's `Cache-Control`, and answers a repeat of a `static`,
 * `daily` or `alerts` GET from memory for a while, so a phone revalidating
 * the stop list by its ETag does not cost a trip to the service and a
 * rebuild of 200 KB of JSON. Only a 200 is kept, and only for the URL it
 * answered, query included.
 *
 * Registered before `RpcResponseInterceptor`, so it sees the status that one
 * sets from the service's answer.
 */
@Injectable()
export class CachePolicyInterceptor implements NestInterceptor {
  private readonly kept = new Map<string, Kept>();

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const kind = this.reflector.getAllAndOverride<CacheKind>(CACHE_KIND, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!kind) return next.handle();
    const policy = POLICIES[kind];
    const http = context.switchToHttp();
    const request = http.getRequest<{ method: string; originalUrl: string }>();
    const response = http.getResponse<{
      statusCode: number;
      setHeader: (name: string, value: string) => void;
    }>();
    if (request.method !== 'GET') return next.handle();
    response.setHeader('Cache-Control', policy.header);
    if (policy.keepMs === 0) return next.handle();

    const key = request.originalUrl;
    const hit = this.kept.get(key);
    if (hit && Date.now() - hit.at < policy.keepMs) {
      this.kept.delete(key);
      this.kept.set(key, hit);
      return of(hit.body);
    }
    return next.handle().pipe(
      tap((body) => {
        if (response.statusCode !== 200) return;
        this.kept.delete(key);
        this.kept.set(key, { at: Date.now(), body });
        while (this.kept.size > KEPT_ENTRIES) {
          const oldest = this.kept.keys().next().value;
          if (oldest === undefined) break;
          this.kept.delete(oldest);
        }
      }),
    );
  }
}
