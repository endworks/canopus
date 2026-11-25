import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiDefaultResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { catchError, firstValueFrom, of, timeout } from 'rxjs';
import {
  AGENDA_PATTERNS,
  foldText,
  rankHits,
  SEARCH_MAX_QUERY,
  searchable,
  SearchHit,
  SearchHitType,
  SERVICE_TOKENS,
  ZARAGOZA_PATTERNS,
} from '@canopus/shared';
import { ErrorResponse } from '../models/error.interface';

/** A service slower than this is left out of the answer, not waited for. */
const SERVICE_DEADLINE_MS = 2500;
/** The most a query ranks: what every page of it is cut from. */
const MAX_RANKED = 200;
/** How long a ranked list answers the same query again, pages included. */
const CACHE_TTL_MS = 60_000;
/** How many queries are kept; the oldest goes first. */
const CACHE_ENTRIES = 500;

/** Which service holds which hit types. */
const OWNERS: Record<string, SearchHitType[]> = {
  agenda: ['series', 'event', 'activity', 'venue'],
  zaragoza: ['bus-line', 'tram-line', 'bus-stop', 'tram-stop', 'bizi-station'],
};

interface Ranked {
  at: number;
  hits: SearchHit[];
  partial: string[];
}

const metres = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
};

/**
 * One search box for Zaragoza: what is on and how to get there.
 *
 * Asks both services that hold something findable in the city at once — the
 * agenda for its series, events and venues, the transit service for its stops
 * and docks — and merges what comes back by the shared score
 * (`@canopus/shared`, `matchScore`), so a stop and an event are ranked on the
 * same terms. Cinemas are not in it: zine serves more than one city and keeps
 * its own listings.
 *
 * A service that fails or is slow is left out and named in `meta.partial`: a
 * search that finds the tram stop while the agenda is down is still a good
 * answer, and the client can say what it could not look in.
 *
 * Given `near`, hits within a kilometre or so rise a little: a reader typing
 * "plaza" in Delicias means the square nearby before the one across town.
 *
 * A query is ranked once, up to 200 hits, and the list kept a minute: every
 * page of it (`offset`, `limit`) is a slice of that list, so scrolling never
 * asks the services again and never shows a hit twice. Only a whole answer is
 * kept; one with a service missing is asked again next time.
 */
@ApiTags('Zaragoza')
@ApiDefaultResponse({ description: 'Error response', type: ErrorResponse })
@Controller('zgz')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);
  private readonly ranked = new Map<string, Ranked>();

  constructor(
    @Inject(SERVICE_TOKENS.agenda) private readonly agenda: ClientProxy,
    @Inject(SERVICE_TOKENS.zaragoza) private readonly zaragoza: ClientProxy,
  ) {}

  @Get('search')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary:
      'Search Zaragoza: events, venues, series, and bus, tram and Bizi stops at once',
  })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({
    name: 'types',
    required: false,
    description:
      'Comma-separated: bus-line, tram-line, bus-stop, tram-stop, bizi-station, series, event, activity, venue',
  })
  @ApiQuery({
    name: 'near',
    required: false,
    description: 'longitude,latitude',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'A page: 1 to 50, 20 by default',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description:
      'Where the page starts: `meta.next` of the last one, 0 by default',
  })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  async search(
    @Query('q') q?: string,
    @Query('types') types?: string,
    @Query('near') near?: string,
    @Query('limit') limit?: string,
    @Query('lang') lang?: string,
    @Query('offset') offset?: string,
  ) {
    const query = (q ?? '').trim();
    if (!query) {
      throw new BadRequestException({
        statusCode: 400,
        error: {
          code: 'invalid_param',
          param: 'q',
          message: 'A query is required',
        },
      });
    }
    if (query.length > SEARCH_MAX_QUERY) {
      throw new BadRequestException({
        statusCode: 400,
        error: {
          code: 'invalid_param',
          param: 'q',
          message: `At most ${SEARCH_MAX_QUERY} characters`,
        },
      });
    }
    const wanted = new Set(
      (types ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean) as SearchHitType[],
    );
    const max = Math.min(Math.max(parseInt(limit ?? '', 10) || 20, 1), 50);
    const start = Math.min(
      Math.max(parseInt(offset ?? '', 10) || 0, 0),
      MAX_RANKED,
    );
    const [lon, lat] = (near ?? '').split(',').map(Number);
    // Rounded to about a hundred metres: close enough to rank by, and readers
    // standing near each other share an answer.
    const origin: [number, number] | undefined =
      Number.isFinite(lon) && Number.isFinite(lat)
        ? [Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000]
        : undefined;

    const page = (ranked: Ranked) => {
      const data = ranked.hits.slice(start, start + max);
      const next = start + max < ranked.hits.length ? start + max : null;
      return {
        data,
        meta: {
          generatedAt: new Date(ranked.at).toISOString(),
          partial: ranked.partial,
          offset: start,
          limit: max,
          total: ranked.hits.length,
          next,
        },
      };
    };

    if (!searchable(query)) {
      return page({ at: Date.now(), hits: [], partial: [] });
    }

    const key = JSON.stringify([
      foldText(query),
      [...wanted].sort(),
      origin,
      lang === 'en' ? 'en' : 'es',
    ]);
    const kept = this.ranked.get(key);
    if (kept && Date.now() - kept.at < CACHE_TTL_MS) return page(kept);

    const ask = (service: string, client: ClientProxy, pattern: string) => {
      const owned = OWNERS[service].filter(
        (t) => wanted.size === 0 || wanted.has(t),
      );
      if (owned.length === 0)
        return Promise.resolve({ service, hits: [] as SearchHit[], ok: true });
      return firstValueFrom(
        client
          .send<SearchHit[] | { statusCode: number }>(pattern, {
            q: query,
            types: owned,
            limit: MAX_RANKED,
            lang,
          })
          .pipe(
            timeout(SERVICE_DEADLINE_MS),
            catchError((error) => {
              this.logger.warn(
                `${service} search failed: ${error?.message ?? error}`,
              );
              return of(null);
            }),
          ),
      ).then((answer) => ({
        service,
        hits: Array.isArray(answer) ? answer : [],
        ok: Array.isArray(answer),
      }));
    };

    const answers = await Promise.all([
      ask('agenda', this.agenda, AGENDA_PATTERNS.search),
      ask('zaragoza', this.zaragoza, ZARAGOZA_PATTERNS.search),
    ]);

    const hits = answers.flatMap((a) => a.hits);
    if (origin) {
      for (const hit of hits) {
        if (!hit.coordinates) continue;
        const distance = metres(origin, hit.coordinates);
        hit.score *= 1 + 0.25 / (1 + distance / 1000);
      }
    }
    const ranked: Ranked = {
      at: Date.now(),
      hits: rankHits(hits, MAX_RANKED),
      partial: answers.filter((a) => !a.ok).map((a) => a.service),
    };
    if (ranked.partial.length === 0) this.keep(key, ranked);
    return page(ranked);
  }

  private keep(key: string, ranked: Ranked) {
    this.ranked.delete(key);
    this.ranked.set(key, ranked);
    while (this.ranked.size > CACHE_ENTRIES) {
      const oldest = this.ranked.keys().next().value;
      if (oldest === undefined) break;
      this.ranked.delete(oldest);
    }
  }
}
