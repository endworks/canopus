import { Injectable, NotFoundException } from '@nestjs/common';
import { Cinema, MovieBasic } from '../models/cinema.interface';
import { ReservaEntradasService } from './reserva-entradas.service';
import { SensaCineService } from './sensacine.service';
import { sanitizeTitle, similarity, venueKey } from '../utils';

/** A site we scrape billboards from. One implementation per site. */
export interface CinemaSource {
  /** Hostname this provider owns, matched against a cinema's source URL. */
  readonly host: string;
  /** Every cinema the site lists. */
  getCinemas(): Promise<Cinema[]>;
  /** Every film showing at one cinema, with its sessions. */
  getMovies(cinemaUrl: string): Promise<MovieBasic[]>;
}

/** Two venue keys that name the same place, allowing for a trailing "sala". */
const alike = (left: string, right: string): boolean =>
  left.includes(right) ||
  right.includes(left) ||
  similarity(left, right) >= 0.8;

/** The site a listing came from, so two listings can be told apart. */
const siteOf = (cinema: Cinema): string => {
  try {
    return new URL(cinema.source ?? '').hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * The venue key with the city dropped from the end. Each site disambiguates
 * its own listing and picks a different qualifier for it: reservaentradas
 * files the Palafox under the street it stands on ('Palafox Independencia'),
 * SensaCine under the city ('Cine Palafox Zaragoza'). Neither key contains the
 * other, so without this they read as two venues.
 */
const withoutCity = (cinema: Cinema): string => {
  const key = venueKey(cinema.name);
  const city = cinema.location
    ? sanitizeTitle(cinema.location.replace(/-/g, ' '))
    : '';
  // A venue named after nothing but its city keeps the city: an empty key
  // would match every other venue in it.
  if (!city || key === city || !key.endsWith(` ${city}`)) return key;
  return key.slice(0, -city.length - 1);
};

/** Two listings of the same venue, allowing for a trailing city or "sala". */
const isSameVenue = (a: Cinema, b: Cinema): boolean => {
  if (a.location?.toLowerCase() !== b.location?.toLowerCase()) return false;
  if (alike(venueKey(a.name), venueKey(b.name))) return true;
  // Only across sites. One site names its own venues consistently, so there a
  // differing qualifier marks a different cinema: 'Cines Verdi' and 'Cines
  // Verdi Park' are two Barcelona venues, not one listed twice.
  return siteOf(a) === siteOf(b)
    ? false
    : alike(withoutCity(a), withoutCity(b));
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
