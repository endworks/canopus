import * as cheerio from 'cheerio';
import {
  compareLineIds,
  fixMojibake,
  publishedLineIds,
  stripBom,
} from './utils';

/**
 * A service alteration as the operator's listing publishes it: a headline, the
 * article it links to, the day it was announced and the lines it names.
 * Everything else about an alteration is prose, and stays behind the link.
 */
export interface ScrapedAlert {
  id: string;
  title: string;
  url: string;
  /** The day it was announced, `YYYY-MM-DD`; the site prints no end date. */
  date?: string;
  lines: string[];
}

const months: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

// The listing prints "25 agosto, 2026"; the articles date themselves
// "25 de agosto de 2026".
const datePattern =
  /(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)[\s,]+(?:de\s+)?(\d{4})/i;

const pad = (value: number) => `${value}`.padStart(2, '0');

export const parseAlertDate = (text: string): string | undefined => {
  const match = text.match(datePattern);
  if (!match) return undefined;
  const month = months[match[2].toLowerCase()];
  const day = Number(match[1]);
  if (!month || day < 1 || day > 31) return undefined;
  return `${match[3]}-${pad(month)}-${pad(day)}`;
};

// "Líneas: 23, 34, 42, Ci1, Ci2, ES7", or a single "Línea: 21".
const lineListPattern = /l[ií]neas?\s*(?:afectadas?)?\s*:([^.\n]*)/i;
export const parseAlertLines = (text: string): string[] =>
  publishedLineIds(
    (text.match(lineListPattern)?.[1] ?? '')
      .split(/[,;/]|\s+y\s+/i)
      // The label is not always closed off by a full stop, so the last id can
      // arrive with the rest of the sentence attached to it.
      .map((part) => part.trim().split(/\s+/)[0]),
  );

const clean = (text: string): string =>
  stripBom(fixMojibake(text)).replace(/\s+/g, ' ').trim();

// Every post on the listing is an alteration, so an entry is a post: the
// selectors WordPress themes wrap one in. The headline is the post's own link.
const entrySelector = 'article, .post, .entry';
const headlineSelector = 'h1 a, h2 a, h3 a, h4 a';

// A listing links its own pages as well as its posts.
const archivePath = /\/(category|tag|author|page|feed)\//;

const alertId = (url: URL): string | undefined => {
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length
    ? decodeURIComponent(segments[segments.length - 1]).toLowerCase()
    : undefined;
};

/**
 * The alerts published on the listing.
 *
 * Nothing here reads the alteration itself: the listing gives a headline, a
 * link, a day and the lines, and whatever else the notice says is read from
 * the article behind it.
 */
export const parseAlerts = (html: string, pageUrl: string): ScrapedAlert[] => {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);

  const postUrl = (href?: string): URL | undefined => {
    if (!href) return undefined;
    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      return undefined;
    }
    url.hash = '';
    const isPost =
      url.host === page.host &&
      url.pathname !== '/' &&
      url.pathname !== page.pathname &&
      !archivePath.test(url.pathname);
    return isPost ? url : undefined;
  };

  const alerts = new Map<string, ScrapedAlert>();
  $(entrySelector).each((_, element) => {
    const entry = $(element);
    const links = [
      ...entry.find(headlineSelector).toArray(),
      ...entry.find('a[href]').toArray(),
    ];
    const link = links
      .map((anchor) => ({ anchor, url: postUrl($(anchor).attr('href')) }))
      .find(({ url }) => url);
    if (!link) return;

    const id = alertId(link.url);
    const title = clean($(link.anchor).text());
    if (!id || !title || alerts.has(id)) return;

    const text = clean(entry.text());
    alerts.set(id, {
      id,
      title,
      url: link.url.href,
      date: parseAlertDate(text),
      lines: parseAlertLines(text).sort(compareLineIds),
    });
  });
  return [...alerts.values()];
};

/**
 * The words of one alert's article, without the furniture around them.
 *
 * The same knowledge as the listing parser, for the page behind a link: what
 * on this site is the notice and what is the theme around it.
 */
export const articleText = (html: string): string => {
  const $ = cheerio.load(html);
  const article = $('article').first();
  const main = $('main').first();
  const body = article.length ? article : main.length ? main : $('body');

  body.find('script, style, nav, header, footer, form, noscript').remove();
  // Text runs straight from one block into the next ("agostoLíneas"), and a
  // model should not have to read words nobody wrote that way.
  body.find('br').replaceWith(' ');
  body
    .find('p, div, li, tr, td, section, blockquote, h1, h2, h3, h4')
    .append(' ');

  // Long enough for any of these notices, short enough to bound one reading.
  return clean(body.text()).slice(0, 12000);
};
