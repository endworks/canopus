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
 * The venue key with the place it stands in dropped from the end. Each site
 * disambiguates its own listing and picks a different qualifier for it:
 * reservaentradas files the Palafox under the street it stands on ('Palafox
 * Independencia'), SensaCine under the town ('Cine Palafox Zaragoza'). Neither
 * key contains the other, so without this they read as two venues.
 */
const placeWords = (place?: string): string =>
  place ? sanitizeTitle(place.replace(/-/g, ' ')) : '';

const withoutPlace = (cinema: Cinema): string => {
  const key = venueKey(cinema.name);
  for (const place of [cinema.town, cinema.location]) {
    const words = placeWords(place);
    // A venue named after nothing but its town keeps the town: an empty key
    // would match every other venue in it.
    if (!words || key === words || !key.endsWith(` ${words}`)) continue;
    return key.slice(0, -words.length - 1);
  }
  return key;
};

/**
 * Whether two listings stand in the same place.
 *
 * The postal code is the only field either site publishes that actually
 * locates a venue. Names don't: there is a Cine Goya in Maella, one in
 * Mequinenza and one in Caspe. Nor does the region, which reservaentradas
 * takes from the URL and SensaCine from whichever index page listed the venue,
 * so all three read as 'zaragoza'.
 *
 * A venue whose page failed to load has no code, and there is no weaker field
 * to fall back to: the region would merge those three Goya. It stays unmatched
 * instead, because a venue listed twice is a far cheaper mistake than two
 * venues collapsed into one — the merged-away listing gets deleted.
 */
const samePlace = (a: Cinema, b: Cinema): boolean =>
  Boolean(a.postalCode && b.postalCode && a.postalCode === b.postalCode);

/**
 * Whether both listings name the same town, allowing for the article and the
 * island or comarca one of them tacks on: 'A Coruña' and 'Coruña', 'Arrecife'
 * and 'Arrecife - Lanzarote'.
 */
const sameTown = (a: Cinema, b: Cinema): boolean => {
  const left = placeWords(a.town);
  const right = placeWords(b.town);
  if (!left || !right) return false;
  return (
    left === right || left.endsWith(` ${right}`) || right.endsWith(` ${left}`)
  );
};

/** Two listings of the same venue, allowing for a trailing town or "sala". */
const isSameVenue = (a: Cinema, b: Cinema): boolean => {
  // The two sites disagree on the postal code often enough that requiring it
  // to match splits real duplicates — the Callao is 28013 on one and 28018 on
  // the other. A name that matches exactly, in a town that matches, is the
  // stronger signal, and it stays clear of the near-misses that share a town:
  // 'Cinesa Diagonal' and 'Cinesa Diagonal Mar' are two Barcelona venues.
  if (sameTown(a, b) && venueKey(a.name) === venueKey(b.name)) return true;
  if (!samePlace(a, b)) return false;
  if (alike(venueKey(a.name), venueKey(b.name))) return true;
  // Only across sites. One site names its own venues consistently, so there a
  // differing qualifier marks a different cinema: 'Cines Verdi' and 'Cines
  // Verdi Park' are two Barcelona venues, not one listed twice.
  return siteOf(a) === siteOf(b)
    ? false
    : alike(withoutPlace(a), withoutPlace(b));
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
