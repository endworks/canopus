import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { lastValueFrom, timeout } from 'rxjs';
import { Cinema, MovieBasic, Session } from '../models/cinema.interface';
import { mapWithLimit } from '@canopus/shared';
import { generateSlug } from '../utils';
import { CinemaSource } from './cinema-source';

const HOST = 'sensacine.com';
const BASE_URL = `https://www.${HOST}`;
const INDEX_URL = `${BASE_URL}/cines/`;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONCURRENT_FETCHES = 4;

/** Cinema ids are namespaced so they can't collide with another provider's. */
const ID_PREFIX = 'sensacine-';

/** `/cines/cine/E0387/` — the site's own stable venue id. */
const VENUE_ID = /\/cines\/cine\/(E\d+)\//i;

/** City pages cover the urban venues, province pages cover everything else. */
const REGION_LINK = /\/cines\/(?:ciudades|provincias)-\d+\//;

/** A film mid-scrape, before its showtimes have all been collected. */
type ScrapedMovie = MovieBasic & { sessions: Session[] };

/** The film cards on a venue page, and the showtimes that belong to them. */
const MOVIE_CARD = '.movie-card-theater';
const SHOWTIME = '[data-showtime-time]';

/**
 * `data-experiences` is a JSON array of tags. The localization ones name the
 * version, e.g. `Localization.Subtitle`; the rest name the format the venue
 * sells, e.g. `Projection.3D` or `Screen.IMAX`, which is most of what
 * distinguishes one screening of a film from the next at a big multiplex.
 */
const VERSION_TAGS: { tag: string; label: string }[] = [
  { tag: 'Localization.Subtitle', label: 'VOSE' },
  { tag: 'Localization.Version.Original', label: 'VO' },
];

const LOCALIZATION_TAG = 'Localization.';

/** Tags every screening carries, so they say nothing about this one. */
const GENERIC_FORMATS = new Set(['Digital', 'Standard']);

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "21 de agosto de 2026" → "2026-08-21". */
const parseSpanishDate = (text: string): string | undefined => {
  const match = /(\d{1,2})\s+de\s+(\p{L}+)\s+de\s+(\d{4})/u.exec(text);
  if (!match) return undefined;
  const month = MONTHS.indexOf(match[2].toLowerCase());
  if (month < 0) return undefined;
  return new Date(Date.UTC(+match[3], month, +match[1]))
    .toISOString()
    .slice(0, 10);
};

/** Strip the label the site prefixes onto each metadata row. */
const afterLabel = (text: string, label: string): string | undefined => {
  const value = text.replace(/\s+/g, ' ').replace(label, '').trim();
  return value || undefined;
};

/**
 * Scrapes sensacine.com, which aggregates showtimes for every Spanish chain —
 * Cinesa included, whose own site is behind a bot challenge.
 *
 * Its listings are shallower than a chain's own site: a venue page carries
 * today and tomorrow only. Deeper dates live behind `/ws/`, which the site's
 * robots.txt disallows, so this provider does not go looking for them.
 */
@Injectable()
export class SensaCineService implements CinemaSource {
  public readonly host = HOST;

  private readonly logger = new Logger(SensaCineService.name);

  constructor(private httpService: HttpService) {}

  private async load(url: string): Promise<cheerio.CheerioAPI> {
    const { data } = await lastValueFrom(
      this.httpService.get(url).pipe(timeout(REQUEST_TIMEOUT_MS)),
    );
    return cheerio.load(data);
  }

  private absolute(path: string): string {
    return path.startsWith('http') ? path : `${BASE_URL}${path}`;
  }

  /** Every cinema in Spain, from the city and province indexes. */
  public async getCinemas(): Promise<Cinema[]> {
    const regions = this.parseRegions(await this.load(INDEX_URL));
    this.logger.log(`sensacine: ${regions.length} regions to scan`);

    const perRegion = await mapWithLimit(
      regions,
      MAX_CONCURRENT_FETCHES,
      async (region) => {
        try {
          return this.parseVenues(await this.load(region.url), region.name);
        } catch (exception) {
          this.logger.warn(
            `sensacine: skipping region '${region.name}': ${exception.message}`,
          );
          return [] as Cinema[];
        }
      },
    );

    const byId = new Map<string, Cinema>();
    for (const cinema of perRegion.flat()) {
      if (!byId.has(cinema.id)) byId.set(cinema.id, cinema);
    }
    this.logger.log(`sensacine: ${byId.size} cinemas`);
    return [...byId.values()];
  }

  private parseRegions($: cheerio.CheerioAPI): { url: string; name: string }[] {
    const regions = new Map<string, string>();
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const name = $(a).text().replace(/\s+/g, ' ').trim();
      if (name && REGION_LINK.test(href) && !regions.has(href)) {
        regions.set(href, name);
      }
    });
    return [...regions].map(([href, name]) => ({
      url: this.absolute(href),
      name,
    }));
  }

  private parseVenues($: cheerio.CheerioAPI, region: string): Cinema[] {
    const venues = new Map<string, Cinema>();
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const id = VENUE_ID.exec(href)?.[1];
      const name = $(a).text().replace(/\s+/g, ' ').trim();
      if (!id || !name || venues.has(id)) return;
      venues.set(id, {
        id: `${ID_PREFIX}${id.toLowerCase()}`,
        name,
        location: generateSlug(region),
        source: this.absolute(href),
      });
    });
    return [...venues.values()];
  }

  /**
   * Every film showing at one venue over the two days the site publishes.
   *
   * Showtimes are nested inside their film's card on some layouts and rendered
   * as a block after it on others, so cards and showtimes are walked together
   * in document order and each showtime is attached to the card it follows.
   * Requiring containment silently returned films with no showtimes at all on
   * the second layout.
   */
  public async getMovies(cinemaUrl: string): Promise<MovieBasic[]> {
    const $ = await this.load(cinemaUrl);
    const movies: ScrapedMovie[] = [];
    let current: ScrapedMovie | null = null;

    $(`${MOVIE_CARD}, ${SHOWTIME}`).each((_, el) => {
      if ($(el).is(MOVIE_CARD)) {
        current = this.parseMovie($, $(el), cinemaUrl);
        if (current) movies.push(current);
        return;
      }
      const session = this.parseSession($(el));
      if (session && current) current.sessions.push(session);
    });

    for (const movie of movies) {
      movie.sessions.sort((a, b) =>
        `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
      );
    }

    // A venue with a billboard but no showtimes anywhere on the page means the
    // markup moved, not that the cinema is shut. Say so: the alternative is an
    // empty listing that looks exactly like a quiet Tuesday.
    if (movies.length && !movies.some((movie) => movie.sessions.length)) {
      this.logger.warn(
        `sensacine: ${movies.length} films but no showtimes at '${cinemaUrl}'`,
      );
    }
    return movies;
  }

  private parseMovie(
    $: cheerio.CheerioAPI,
    card: cheerio.Cheerio<any>,
    cinemaUrl: string,
  ): ScrapedMovie | null {
    const name = card
      .find('.meta-title')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) return null;

    const meta = card
      .find('.meta-body-item')
      .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
      .get();
    const find = (label: string) => meta.find((line) => line.startsWith(label));

    const headline = meta[0] ?? '';
    const genres = headline
      .split('|')[1]
      ?.split('/')[0]
      ?.split(',')
      .map((genre) => genre.trim())
      .filter(Boolean);
    const director = find('Dirigida por');
    const cast = find('Reparto');
    const originalName = find('Título original');
    const path = card
      .find('a[href*="/peliculas/pelicula-"]')
      .first()
      .attr('href');

    return {
      id: generateSlug(name),
      name,
      originalName: originalName && afterLabel(originalName, 'Título original'),
      releaseDate: parseSpanishDate(headline),
      genres: genres?.length ? genres : undefined,
      director: director
        ? { name: afterLabel(director, 'Dirigida por') }
        : undefined,
      actors: afterLabel(cast ?? '', 'Reparto')
        ?.split(',')
        .map((actor) => ({ name: actor.trim() }))
        .filter((actor) => actor.name),
      poster: card.find('img').first().attr('src'),
      sessions: [],
      sourceId: VENUE_ID.exec(cinemaUrl)?.[1],
      source: path ? this.absolute(path) : cinemaUrl,
    };
  }

  /**
   * One showtime. It carries its own ISO timestamp, so unlike a day/month tab
   * list there is no date to reconstruct and no year to guess.
   */
  private parseSession(el: cheerio.Cheerio<any>): Session | null {
    const stamp = el.attr('data-showtime-time');
    if (!stamp) return null;
    const href = this.bookingLink(el);
    return {
      id: el.attr('data-showtime-id'),
      time: stamp.slice(11, 16),
      date: stamp.slice(0, 10),
      type: this.sessionType(el),
      url: href ? this.absolute(href) : undefined,
    };
  }

  /**
   * The link that books this showtime. The site makes the time itself the
   * anchor on some layouts and wraps it on others, so try the element, then
   * what encloses it, then what it encloses.
   */
  private bookingLink(el: cheerio.Cheerio<any>): string | undefined {
    const anchors = [
      el.is('a[href]') ? el : null,
      el.closest('a[href]').first(),
      el.find('a[href]').first(),
    ];
    for (const anchor of anchors) {
      const href = anchor?.attr('href');
      if (href) return href;
    }
    return undefined;
  }

  /**
   * What a viewer is choosing between: the version (VO/VOSE) and the format
   * sold at the door (3D, IMAX, VIP). A tag is read as its last segment, so a
   * format this scraper has never heard of still reaches the listing.
   */
  private sessionType(el: cheerio.Cheerio<any>): string | null {
    const experiences = this.experiences(el);
    const version = VERSION_TAGS.find(({ tag }) =>
      experiences.some((experience) => experience.startsWith(tag)),
    );
    const formats = experiences
      .filter((experience) => !experience.startsWith(LOCALIZATION_TAG))
      .map((experience) => experience.split('.').pop())
      .filter((format) => format && !GENERIC_FORMATS.has(format));
    const labels = [...new Set([version?.label, ...formats].filter(Boolean))];
    return labels.join(', ') || null;
  }

  /** One unreadable attribute must not cost the venue its whole billboard. */
  private experiences(el: cheerio.Cheerio<any>): string[] {
    const raw = el.attr('data-experiences');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((tag): tag is string => typeof tag === 'string')
        : [];
    } catch {
      this.logger.debug(`sensacine: unreadable data-experiences: '${raw}'`);
      return [];
    }
  }
}
