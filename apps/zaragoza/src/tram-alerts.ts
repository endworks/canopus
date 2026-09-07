import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';

import { ScrapedAlert } from './alerts';
import { TRAM_LINE_ID } from './tram-line';

/**
 * The tram operator's site, which is where the network's alterations are
 * published. The bus alterations come from the bus operator's site; these come
 * from this one, and the two have nothing in common but being WordPress.
 */
export const tramSiteURL = 'https://www.tranviasdezaragoza.es';

/**
 * The front page, which is where a live alteration is shown.
 *
 * With a query string on it, and not for cache-busting: the site answers the
 * bare `/` with a 302 to `http://127.0.0.1`, which is a redirect rule of
 * theirs that matches the path exactly and is plainly not meant for anybody.
 * Any query at all goes past it to the page a reader sees.
 */
export const tramFrontPageURL = `${tramSiteURL}/?canopus=1`;

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The slug a post's URL ends in, which is the id an alteration is kept under.
 *
 * The same rule the bus alerts use, so the two kinds of alert are identified
 * the same way: a WordPress post is its slug, and nothing else about it is
 * stable across an edit.
 */
export const alertId = (link: string, slug?: string): string | undefined => {
  if (slug) return slug.toLowerCase();
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length
    ? decodeURIComponent(segments[segments.length - 1]).toLowerCase()
    : undefined;
};

/**
 * A link on this site, or nothing: an alert points at its own operator.
 *
 * `base` is given only where a relative href is a real possibility — the
 * markup of the block at the top is somebody's hand-written HTML. A post's
 * `link` is always absolute, and resolving it against the site would turn a
 * field of junk into a page of ours that does not exist.
 */
const ownLink = (href: string | undefined, base?: string): URL | undefined => {
  if (!href) return undefined;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return undefined;
  }
  if (url.host !== new URL(tramSiteURL).host) return undefined;
  url.hash = '';
  return url;
};

/**
 * An alteration in force, as the block at the top of the front page shows it.
 *
 * That block is the operator's own — their plugin renders it, and its markup
 * is theirs rather than the theme's: a `tranvias_dosnet_avisos` container with
 * one `tranvias_dosnet_avisos_aviso` per alteration inside it. Which is why
 * these are read by those class names and not by shape: the heading beside
 * them and the hairline between them are elements too, and reading "AVISOS"
 * as an alteration would put a notice on every stop that says nothing.
 *
 * There is normally nothing here. The block appears when something is wrong
 * with the service right now and goes when it is over, which is exactly what
 * makes it worth reading — the posts below the fold are what was announced,
 * and this is what is happening.
 */
export const parseLiveAlerts = (html: string): ScrapedAlert[] => {
  const $ = cheerio.load(html);
  const alerts = new Map<string, ScrapedAlert>();

  $('.tranvias_dosnet_avisos_aviso').each((_, element) => {
    const aviso = $(element);
    const title = clean(aviso.text());
    if (!title) return;

    // Where the notice links to its own article, that article's slug is its
    // id and the two are one alert rather than two — the same alteration is
    // often both the block at the top and the post below it.
    const url = ownLink(
      aviso.find('a[href]').first().attr('href'),
      tramSiteURL,
    );
    const id = url ? alertId(url.href) : liveAlertId(title);
    if (!id) return;

    alerts.set(id, {
      id,
      title,
      // With nothing linked, the page that is showing it is where a reader
      // goes to read it.
      url: url?.href ?? `${tramSiteURL}/`,
      lines: [TRAM_LINE_ID],
    });
  });

  return [...alerts.values()];
};

/**
 * The id of a notice that links to nothing.
 *
 * Taken from its own words, because there is nothing else: the block carries
 * no slug, no date and no id of its own. It holds while the wording does,
 * which is what an id has to do here — a run stores what the site is showing
 * and drops the rest, so an alert whose id changed would come back as a new
 * one rather than the same one going on.
 */
const liveAlertId = (title: string): string =>
  `aviso-${createHash('sha256').update(title.toLowerCase()).digest('hex').slice(0, 12)}`;
