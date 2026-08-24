import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { lastValueFrom, timeout } from 'rxjs';
import { Cinema, MovieBasic, Session } from '../models/cinema.interface';
import { mapWithLimit } from '@canopus/shared';
import { generateSlug, minutesToString } from '../utils';
import { CinemaSource } from './cinema-source';

const HOST = 'reservaentradas.com';
const CINEMAS_URL = `https://www.${HOST}/cines`;
const REQUEST_TIMEOUT_MS = 10000;

/** reservaentradas is a small PHP site — don't open a socket per film. */
const MAX_CONCURRENT_FETCHES = 4;

/**
 * Venue programmes that prefix the film title on reservaentradas. One pattern
 * per entry does both the detection and the stripping, so the two can't drift
 * and adding a programme is a one-line data edit.
 */
const SPECIAL_EDITIONS: { label: string; pattern: RegExp }[] = [
  { label: 'Cine Club Lys', pattern: /\s*CINE CLUB LYS\s*:?\s*/i },
  { label: 'Proyecto Viridiana', pattern: /\s*PROYECTO VIRIDIANA\s*:?\s*/i },
  { label: 'Club Rosebud', pattern: /\s*-?\s*CLUB ROSEBUD\s*/i },
  { label: '4K', pattern: /\s*4K\s*/i },
];

/** Anniversary re-releases carry the edition in the title itself. */
const ANNIVERSARY = /\(?\s*(\d+ aniversario)\s*\)?/i;

/** Venues whose real name starts with "Cine …" and must keep the prefix. */
const KEEP_CINE_PREFIX = /^Cine Y/i;

/** Trailing numeric segment of a film or session URL — a stable per-site id. */
const SOURCE_ID = /\/(\d+)\/?(?:\?|$)/;

const SPANISH_RATING = /menores de (\d+)/i;
const ALL_AGES = /apto para todos/i;

/** `Sala: <b>2</b>`, `Formato: <span …>(VOSE)</span>`, `Numerada: <b> Sí </b>` */
const POPOVER = {
  screen: /Sala:\s*(?:<[^>]+>)*\s*([^<]+)/i,
  format: /Formato:\s*(?:<[^>]+>)*\s*([^<]+)/i,
  numbered: /Numerada:\s*(?:<[^>]+>)*\s*([^<]+)/i,
};

/** Spanish age classification, as a minimum age. "Apto para todos" is 0. */
const parseMinimumAge = (label: string): number | undefined => {
  if (ALL_AGES.test(label)) return 0;
  const match = SPANISH_RATING.exec(label);
  return match ? parseInt(match[1], 10) : undefined;
};

/**
 * Listings give day and month only. Pick the year that puts the date nearest
 * today, so a January session listed in December lands next year instead of
 * eleven months in the past. Built in UTC: containers run UTC, and a local
 * midnight would round to the previous day at any positive offset.
 */
const resolveDate = (day: number, month: number, now = Date.now()): string => {
  const year = new Date(now).getUTCFullYear();
  return [year - 1, year, year + 1]
    .map((candidate) => new Date(Date.UTC(candidate, month - 1, day)))
    .reduce((best, date) =>
      Math.abs(date.getTime() - now) < Math.abs(best.getTime() - now)
        ? date
        : best,
    )
    .toISOString()
    .slice(0, 10);
};

const sourceId = (url?: string): string | undefined =>
  SOURCE_ID.exec(url ?? '')?.[1];

/** One film as the cinema listing describes it, before its page is fetched. */
interface BillboardEntry {
  source: string;
  /** Single Spanish genre; the listing is the only page that carries it. */
  genre?: string;
}

/**
 * Scrapes reservaentradas.com. Kept separate from CinemaService so the part
 * that breaks when someone else edits their markup has no cache, database or
 * enrichment concerns mixed into it.
 */
@Injectable()
export class ReservaEntradasService implements CinemaSource {
  public readonly host = HOST;

  private readonly logger = new Logger(ReservaEntradasService.name);

  constructor(private httpService: HttpService) {}

  private async load(url: string): Promise<cheerio.CheerioAPI> {
    const { data } = await lastValueFrom(
      this.httpService.get(url).pipe(timeout(REQUEST_TIMEOUT_MS)),
    );
    return cheerio.load(data);
  }

  /** Every cinema listed, across all provinces. */
  public async getCinemas(): Promise<Cinema[]> {
    const $ = await this.load(CINEMAS_URL);
    const cinemas: Cinema[] = [];

    $('li.provincia').each((_, el) => {
      const city = $(el).clone().children().remove().end().text().trim();
      $(el)
        .find('ul.list-cinemas li a')
        .each((_, a) => {
          let name = $(a).text().trim();
          if (!KEEP_CINE_PREFIX.test(name)) {
            name = name.replace(/^\s*Cines?\s+/i, '');
          }
          const source = $(a).attr('href') || '';
          const segments = source.split('/');
          cinemas.push({
            id: (segments[5] || '').replace(/^cines?/i, ''),
            name: name.replace(/\s+/g, ' ').trim(),
            location: segments[4] || city.toLowerCase().replace(/\s+/g, '-'),
            source,
          });
        });
    });

    return cinemas;
  }

  /** Every film currently showing at one cinema, with its sessions. */
  public async getMovies(cinemaUrl: string): Promise<MovieBasic[]> {
    const entries = this.parseBillboard(await this.load(cinemaUrl));
    return mapWithLimit(entries, MAX_CONCURRENT_FETCHES, (entry) =>
      this.getMovie(entry),
    );
  }

  /**
   * The listing carries the genre and links to each film. Sessions are not
   * usable from here: the listing shows only the next few, while the film page
   * has the full run across every date.
   */
  private parseBillboard($: cheerio.CheerioAPI): BillboardEntry[] {
    const entries: BillboardEntry[] = [];
    $('.movie.row').each((_, el) => {
      const source = $(el).find('a').attr('href');
      if (!source) return;
      entries.push({
        source,
        genre:
          $(el)
            .find('.event-description-short')
            .text()
            .trim()
            .replace(/\.$/, '') || undefined,
      });
    });
    return entries;
  }

  private async getMovie({
    source,
    genre,
  }: BillboardEntry): Promise<MovieBasic> {
    const $ = await this.load(source);
    const { name, specialEdition } = this.parseTitle(
      $('h2 strong').first().text(),
    );
    const duration = parseInt(
      $('.member-descriptionX > p > strong').text().split(' ')[0],
    );
    const ageRating = $('.calification-box').text().replace(/\s+/g, ' ').trim();

    return {
      id: generateSlug(name),
      name,
      specialEdition,
      synopsis: $('#sinopsis_info span').text().replace(/\n/, '').trim(),
      duration,
      durationReadable: minutesToString(duration),
      genres: genre ? [genre] : undefined,
      ageRating: ageRating || undefined,
      minimumAge: parseMinimumAge(ageRating),
      sessions: this.parseSessions($),
      poster: $('.media-object').attr('src')?.split('?')[0],
      trailer: $('#trailer iframe').attr('src'),
      sourceId: sourceId(source),
      source,
    };
  }

  private parseTitle(raw: string): { name: string; specialEdition?: string } {
    for (const { label, pattern } of SPECIAL_EDITIONS) {
      if (pattern.test(raw)) {
        return {
          name: this.cleanName(raw.replace(pattern, ' ')),
          specialEdition: label,
        };
      }
    }
    const anniversary = ANNIVERSARY.exec(raw);
    if (anniversary) {
      return {
        name: this.cleanName(raw.replace(ANNIVERSARY, ' ')),
        specialEdition: anniversary[1],
      };
    }
    return { name: this.cleanName(raw), specialEdition: null };
  }

  /** Drop the release year the listings append, e.g. "Alien (1979)". */
  private cleanName(name: string): string {
    return name
      .replace(/\(\s*\d{4}\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Each date tab holds one pane of sessions. Screen, format and numbered
   * seating come from the per-session popover rather than the pane's format
   * heading, which only describes the first group on the pane.
   */
  private parseSessions($: cheerio.CheerioAPI): Session[] {
    const dates: string[] = [];
    $('ul.nav-tabs li a').each((_, el) => {
      const match = $(el)
        .text()
        .match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
      dates.push(
        match
          ? resolveDate(parseInt(match[1], 10), parseInt(match[2], 10))
          : null,
      );
    });

    const sessions: Session[] = [];
    dates.forEach((date, index) => {
      if (!date) return;
      $(`#${index + 1} .session-container`).each((_, el) => {
        const popover = $(el).attr('popover-content') || '';
        const link = $(el).find('a.sesion');
        const field = (pattern: RegExp) => pattern.exec(popover)?.[1].trim();
        const format =
          field(POPOVER.format) || $(el).find('.label-cinema').text().trim();
        const numbered = field(POPOVER.numbered);

        sessions.push({
          id: sourceId(link.attr('href')),
          time: link.text().trim(),
          url: link.attr('href'),
          screen: field(POPOVER.screen) || null,
          date,
          type: format.replace(/[()]/g, '').trim() || null,
          numbered: numbered ? /^s[ií]$/i.test(numbered) : undefined,
        });
      });
    });

    return sessions.sort(
      (a, b) =>
        new Date(`${a.date}T${a.time}:00Z`).getTime() -
        new Date(`${b.date}T${b.time}:00Z`).getTime(),
    );
  }
}
