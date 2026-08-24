import { Injectable, NotFoundException } from '@nestjs/common';
import { Cinema, MovieBasic } from '../models/cinema.interface';
import { ReservaEntradasService } from './reserva-entradas.service';
import { SensaCineService } from './sensacine.service';
import { similarity, venueKey } from '../utils';

/** A site we scrape billboards from. One implementation per site. */
export interface CinemaSource {
  /** Hostname this provider owns, matched against a cinema's source URL. */
  readonly host: string;
  /** Every cinema the site lists. */
  getCinemas(): Promise<Cinema[]>;
  /** Every film showing at one cinema, with its sessions. */
  getMovies(cinemaUrl: string): Promise<MovieBasic[]>;
}

/** Two listings of the same venue, allowing for a trailing city or "sala". */
const isSameVenue = (a: Cinema, b: Cinema): boolean => {
  if (a.location?.toLowerCase() !== b.location?.toLowerCase()) return false;
  const left = venueKey(a.name);
  const right = venueKey(b.name);
  return (
    left.includes(right) ||
    right.includes(left) ||
    similarity(left, right) >= 0.8
  );
};

/**
 * Resolves which site a cinema came from, and merges their catalogues.
 *
 * Order matters: providers listed first win when the same venue appears on
 * more than one site, so the richer source keeps the venue.
 */
@Injectable()
export class CinemaSources {
  private readonly sources: CinemaSource[];

  constructor(
    reservaEntradas: ReservaEntradasService,
    sensaCine: SensaCineService,
  ) {
    // reservaentradas first: it carries the full multi-week run and direct
    // booking links, where SensaCine only lists today and tomorrow.
    this.sources = [reservaEntradas, sensaCine];
  }

  public all(): CinemaSource[] {
    return this.sources;
  }

  /** The provider that owns this cinema's source URL. */
  public for(sourceUrl: string): CinemaSource {
    const source = this.sources.find((candidate) =>
      (sourceUrl ?? '').includes(candidate.host),
    );
    if (!source) {
      throw new NotFoundException(
        `No scraper knows how to read '${sourceUrl || '(missing source)'}'`,
      );
    }
    return source;
  }

  /** Drop venues a higher-priority provider already listed. */
  public dedupe(cinemas: Cinema[]): Cinema[] {
    const kept: Cinema[] = [];
    for (const cinema of cinemas) {
      if (!kept.some((existing) => isSameVenue(existing, cinema))) {
        kept.push(cinema);
      }
    }
    return kept;
  }
}
