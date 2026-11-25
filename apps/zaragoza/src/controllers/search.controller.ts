import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import {
  rankHits,
  SEARCH_MAX_QUERY,
  searchable,
  SearchHit,
  SearchHitType,
  SearchPayload,
  ZARAGOZA_PATTERNS,
} from '@canopus/shared';
import { BiziService } from '../services/bizi.service';
import { BusService } from '../services/bus.service';
import { TramService } from '../services/tram.service';
import {
  SearchableLine,
  searchLines,
  SearchableStation,
  searchStations,
} from '../search';
import { boardsOf } from '../tram-line';

/** How many hits a search may ask for: the gateway pages through at most this many. */
const MAX_HITS = 200;

/**
 * Stops and docks for the gateway's global search.
 *
 * Read from each network's own cached station list, so a search costs no
 * request to the operators. A network whose list cannot be read is left out
 * of the answer rather than failing it: a search that finds tram stops while
 * the bus list is down is still a search.
 */
@Controller()
export class SearchController {
  constructor(
    private readonly bus: BusService,
    private readonly tram: TramService,
    private readonly bizi: BiziService,
  ) {}

  @MessagePattern(ZARAGOZA_PATTERNS.search, Transport.TCP)
  async search(@Payload() payload: SearchPayload): Promise<SearchHit[]> {
    const query = (payload?.q ?? '').slice(0, SEARCH_MAX_QUERY);
    if (!searchable(query)) return [];
    const english = payload.lang === 'en';
    const types = new Set(payload.types ?? []);
    const wants = (type: SearchHitType) => types.size === 0 || types.has(type);
    const list = async <T>(read: () => Promise<unknown>): Promise<T[]> => {
      try {
        const stations = await read();
        return stations &&
          typeof stations === 'object' &&
          !('statusCode' in stations)
          ? Object.values(stations as Record<string, T>)
          : [];
      } catch {
        return [];
      }
    };

    const hits: SearchHit[] = [];
    const lineTitle = (line: SearchableLine) =>
      `${english ? 'Line' : 'Línea'} ${line.id}`;
    if (wants('bus-line')) {
      hits.push(
        ...searchLines(
          await list<SearchableLine>(() => this.bus.getLines()),
          query,
          'bus-line',
          lineTitle,
        ),
      );
    }
    if (wants('tram-line')) {
      hits.push(
        ...searchLines(
          await list<SearchableLine>(() => this.tram.getLines()),
          query,
          'tram-line',
          lineTitle,
        ),
      );
    }
    if (wants('bus-stop')) {
      hits.push(
        ...searchStations(
          await list<SearchableStation>(() => this.bus.getStations()),
          query,
          'bus-stop',
          (s) =>
            [`Parada ${s.id}`, s.lines?.length ? s.lines.join(', ') : undefined]
              .filter(Boolean)
              .join(' · '),
        ),
      );
    }
    if (wants('tram-stop')) {
      hits.push(
        ...searchStations(
          await list<SearchableStation>(() => this.tram.getStations()),
          query,
          'tram-stop',
          (s) =>
            s.lines?.length ? `Tranvía ${s.lines.join(', ')}` : 'Tranvía',
          // Signed with its platforms' numbers; its own id is a place code no pole carries.
          (s) => boardsOf(s.id),
        ),
      );
    }
    if (wants('bizi-station')) {
      hits.push(
        ...searchStations(
          await list<SearchableStation>(() => this.bizi.getStations()),
          query,
          'bizi-station',
          (s) => `Bizi ${s.id}`,
        ),
      );
    }
    return rankHits(hits, Math.min(payload.limit ?? 30, MAX_HITS));
  }
}
