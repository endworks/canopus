import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import {
  rankHits,
  SEARCH_MAX_QUERY,
  SearchHit,
  SearchHitType,
  SearchPayload,
  ZARAGOZA_PATTERNS,
} from '@canopus/shared';
import { BiziService } from '../services/bizi.service';
import { BusService } from '../services/bus.service';
import { TramService } from '../services/tram.service';
import { SearchableStation, searchStations } from '../search';

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
    if (!query.trim()) return [];
    const types = new Set(payload.types ?? []);
    const wants = (type: SearchHitType) => types.size === 0 || types.has(type);
    const list = async (
      read: () => Promise<unknown>,
    ): Promise<SearchableStation[]> => {
      try {
        const stations = await read();
        return stations &&
          typeof stations === 'object' &&
          !('statusCode' in stations)
          ? Object.values(stations as Record<string, SearchableStation>)
          : [];
      } catch {
        return [];
      }
    };

    const hits: SearchHit[] = [];
    if (wants('bus-stop')) {
      hits.push(
        ...searchStations(
          await list(() => this.bus.getStations()),
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
          await list(() => this.tram.getStations()),
          query,
          'tram-stop',
          (s) =>
            s.lines?.length ? `Tranvía ${s.lines.join(', ')}` : 'Tranvía',
        ),
      );
    }
    if (wants('bizi-station')) {
      hits.push(
        ...searchStations(
          await list(() => this.bizi.getStations()),
          query,
          'bizi-station',
          (s) => `Bizi ${s.id}`,
        ),
      );
    }
    return rankHits(hits, Math.min(payload.limit ?? 30, 100));
  }
}
