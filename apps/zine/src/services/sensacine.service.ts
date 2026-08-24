import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { lastValueFrom, timeout } from 'rxjs';
import { Cinema, MovieBasic, Session } from '../models/cinema.interface';
import { generateSlug, mapWithLimit } from '../utils';
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

/**
 * `data-experiences` is a JSON array of tags. Only the localization ones say
 * anything a viewer cares about; the rest describe projection hardware.
 */
const VERSION_TAGS: { tag: string; label: string }[] = [
  { tag: 'Localization.Subtitle', label: 'VOSE' },
  { tag: 'Localization.Version.Original', label: 'VO' },
];

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

  /** Every film showing at one venue over the two days the site publishes. */
  public async getMovies(cinemaUrl: string): Promise<MovieBasic[]> {
    const $ = await this.load(cinemaUrl);
    const movies: MovieBasic[] = [];
    $('.movie-card-theater').each((_, el) => {
      const movie = this.parseMovie($, $(el), cinemaUrl);
      if (movie) movies.push(movie);
    });
    return movies;
  }

  private parseMovie(
    $: cheerio.CheerioAPI,
    card: cheerio.Cheerio<any>,
    cinemaUrl: string,
  ): MovieBasic | null {
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
      sessions: this.parseSessions($, card),
      sourceId: VENUE_ID.exec(cinemaUrl)?.[1],
      source: path ? this.absolute(path) : cinemaUrl,
    };
  }

  /**
   * Every showtime carries its own ISO timestamp and format tags, so unlike a
   * day/month tab list there is no date to reconstruct and no year to guess.
   */
  private parseSessions(
    $: cheerio.CheerioAPI,
    card: cheerio.Cheerio<any>,
  ): Session[] {
    const sessions: Session[] = [];
    card.find('[data-showtime-time]').each((_, el) => {
      const stamp = $(el).attr('data-showtime-time');
      if (!stamp) return;
      const experiences: string[] = JSON.parse(
        $(el).attr('data-experiences') || '[]',
      );
      const version = VERSION_TAGS.find(({ tag }) =>
        experiences.some((experience) => experience.startsWith(tag)),
      );
      sessions.push({
        id: $(el).attr('data-showtime-id'),
        time: stamp.slice(11, 16),
        date: stamp.slice(0, 10),
        type: version?.label ?? null,
      });
    });
    return sessions.sort((a, b) =>
      `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
    );
  }
}
