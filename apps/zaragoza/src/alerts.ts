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

/** The slug a post's URL ends in, which is the only id these notices have. */
const alertId = (url: URL): string | undefined => {
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length
    ? decodeURIComponent(segments[segments.length - 1]).toLowerCase()
    : undefined;
};

/**
 * The nonce the alterations endpoint will not answer without.
 *
 * The line pages print an empty `#avisos` and fill it from admin-ajax, which
 * rejects a request with no nonce outright. It is minted per page load, so it
 * is read from the page that was just fetched rather than remembered.
 */
export const parseAlertsNonce = (html: string): string | undefined =>
  cheerio.load(html)('#avz_alteraciones_ajax_nonce').attr('value') || undefined;

/**
 * One page of the alterations the site is currently showing.
 *
 * This is the fragment admin-ajax returns, not a page: a run of
 * `.container-post`, each with the headline and its link, the day it was
 * announced and the lines it names. What the site lists here is what it is
 * showing a traveller today — an alteration announced in January and still in
 * force is on it, and one that is over is not, which is the whole reason for
 * reading it rather than the category archive.
 */
export const parseAlterations = (
  fragment: string,
  pageUrl: string,
): ScrapedAlert[] => {
  const $ = cheerio.load(fragment);
  const alerts: ScrapedAlert[] = [];

  $('.container-post').each((_, element) => {
    const entry = $(element);
    const anchor = entry.find('.container-post-title a').first();
    const href = anchor.attr('href');
    if (!href) return;

    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      return;
    }
    url.hash = '';
    // The fragment is somebody else's HTML: an alteration is a post on this
    // site, and a link anywhere else is not one.
    if (url.host !== new URL(pageUrl).host) return;

    const id = alertId(url);
    const title = clean(anchor.text());
    if (!id || !title) return;

    alerts.push({
      id,
      title,
      url: url.href,
      date: parseAlertDate(clean(entry.find('.container-entry-date').text())),
      lines: parseAlertLines(
        clean(entry.find('.container-post-lines').text()),
      ).sort(compareLineIds),
    });
  });
  return alerts;
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
