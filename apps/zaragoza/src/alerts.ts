import * as cheerio from 'cheerio';
import {
  compareLineIds,
  fixMojibake,
  publishedLineId,
  stripBom,
} from './utils';

/**
 * A service alteration as the site publishes it under "Últimas alteraciones
 * del servicio": a headline, the article it links to, the day it was announced
 * and the lines it names. Everything else about an alteration is prose, and
 * stays on the site behind the link.
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
const lineLabelPattern = /l[ií]neas?\s*(?:afectadas?)?\s*:/gi;

// An id is at most a short prefix and a number ("21", "Ci1", "TUR", "ES7"), so
// a listing that reads "Líneas: todas" contributes none rather than a word.
const lineIdPattern = /^(?=.*[a-z0-9])[a-z]{0,3}\d{0,3}$/i;

export const parseAlertLines = (text: string): string[] => [
  ...new Set(
    (text.match(lineListPattern)?.[1] ?? '')
      .split(/[,;/]|\s+y\s+/i)
      // The label is not always closed off by a full stop, so the last id can
      // arrive with the rest of the sentence attached to it.
      .map((part) => part.trim().split(/\s+/)[0])
      .filter((part) => lineIdPattern.test(part))
      .map(publishedLineId)
      .filter(Boolean),
  ),
];

const labelCount = (text: string): number =>
  text.match(lineLabelPattern)?.length ?? 0;

const clean = (text: string): string =>
  stripBom(fixMojibake(text)).replace(/\s+/g, ' ').trim();

// Links that sit in the same block as an entry without being one.
const notAnEntry = /avisos\s+anteriores|leer\s+m[áa]s|ver\s+m[áa]s|compartir/i;

// How far above the "Líneas:" label an entry's own container can sit. Walking
// further reaches the block that holds every entry, where the label appears
// more than once — which is what stops the walk regardless.
const maxEntryDepth = 6;

const alertId = (url: URL): string | undefined => {
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length
    ? decodeURIComponent(segments[segments.length - 1]).toLowerCase()
    : undefined;
};

/**
 * The alerts published on one page.
 *
 * The theme's markup is not a contract, so nothing here depends on its class
 * names: an entry is found by its "Líneas:" label and paired with the nearest
 * enclosing block that links to an article, which survives the block being
 * a `<div>` one release and an `<article>` the next.
 */
export const parseAlerts = (html: string, pageUrl: string): ScrapedAlert[] => {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  const found: ScrapedAlert[] = [];

  const entryUrl = (href?: string, title?: string): URL | undefined => {
    if (!href || !title || notAnEntry.test(title)) return undefined;
    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      return undefined;
    }
    url.hash = '';
    if (url.host !== page.host) return undefined;
    // The listing links itself and its own section; neither is an article.
    if (url.pathname === '/' || url.pathname === page.pathname)
      return undefined;
    return url;
  };

  // The innermost element holding a "Líneas:" label: one per published entry.
  const labels = $('*')
    .toArray()
    .filter(
      (el) =>
        labelCount($(el).text()) > 0 &&
        $(el)
          .children()
          .toArray()
          .every((child) => labelCount($(child).text()) === 0),
    );

  labels.forEach((label) => {
    let container = $(label);
    for (let depth = 0; depth <= maxEntryDepth; depth++) {
      // Past this entry and into the list of them: the pairing would be a
      // guess, so leave this label to the entry that does contain a link.
      if (labelCount(container.text()) > 1) return;

      const links = container
        .find('a[href]')
        .toArray()
        .map((element) => ({
          element,
          url: entryUrl($(element).attr('href'), clean($(element).text())),
        }))
        .filter((link) => link.url);

      if (links.length) {
        // A headline reads longer than the "»" links that share its block.
        const { element, url } = links.sort(
          (a, b) => $(b.element).text().length - $(a.element).text().length,
        )[0];
        const id = alertId(url);
        const text = clean(container.text());
        if (id) {
          found.push({
            id,
            title: clean($(element).text()),
            url: url.href,
            date: parseAlertDate(text),
            lines: parseAlertLines(text),
          });
        }
        return;
      }

      const parent = container.parent();
      if (!parent.length) return;
      container = parent;
    }
  });

  return mergeAlerts(found);
};

/**
 * One entry per alert, whichever page it was read from. The same alteration is
 * published on more than one page, and a page that names fewer lines than
 * another is not a page that unaffects them.
 */
export const mergeAlerts = (alerts: ScrapedAlert[]): ScrapedAlert[] => {
  const merged = new Map<string, ScrapedAlert>();
  alerts.forEach((alert) => {
    const seen = merged.get(alert.id);
    merged.set(alert.id, {
      ...seen,
      ...alert,
      title: seen?.title || alert.title,
      date: seen?.date ?? alert.date,
      lines: [...new Set([...(seen?.lines ?? []), ...alert.lines])].sort(
        compareLineIds,
      ),
    });
  });
  return [...merged.values()];
};
