import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';

import { articleText, ScrapedAlert } from './alerts';
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

/**
 * The WordPress REST API, under `/api/`.
 *
 * Not `/wp-json/`, which this site answers 404: the prefix is configurable and
 * theirs is changed. It is the site's own pages that give it away — they link
 * their oembed endpoint under `/api/`, so that is what is asked.
 */
const restBase = `${tramSiteURL}/api/wp/v2`;

/**
 * The categories a service alteration is filed under.
 *
 * `home` is the one that exists, and it is the operator's own featured set:
 * every alteration they publish is in it — the extended hours for a festival,
 * the reinforcement for a match, the special services for the fiestas — while
 * the general press releases stay in `noticias` alone. It is not named for
 * what it holds, so the others are asked for too, against the day somebody
 * files these where their name says.
 */
const alertCategorySlugs = ['home', 'incidencias', 'avisos', 'alteraciones'];

/**
 * How many notices back a listing is read.
 *
 * These are what the operator is still showing below the fold, and an
 * alteration that is over drops off the list on its own end date; a page of
 * fifty is well past the point where the rest is history rather than news.
 */
export const maxTramAlerts = 50;

/** One post, as the WordPress REST API returns it. */
export interface WordPressPost {
  id?: number;
  slug?: string;
  link?: string;
  date?: string;
  date_gmt?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
}

export interface WordPressCategory {
  id?: number;
  slug?: string;
}

/** The ids of the categories an alteration is filed under. */
export const alertCategoryIds = (
  categories: WordPressCategory[] | undefined,
): number[] =>
  (categories ?? [])
    .filter(
      (category) =>
        typeof category.id === 'number' &&
        alertCategorySlugs.includes(category.slug ?? ''),
    )
    .map((category) => category.id);

export const categoriesQuery = () =>
  `${restBase}/categories?per_page=100&_fields=id,slug`;

export const postsQuery = (categoryIds: number[]) =>
  `${restBase}/posts?categories=${categoryIds.join(',')}&per_page=${maxTramAlerts}&_fields=slug,link,date,title,content`;

/** WordPress renders `&amp;` and friends into the titles it hands back. */
const decodeEntities = (text: string): string =>
  cheerio.load(`<span>${text}</span>`)('span').text();

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
 * The alterations the REST API lists, in this service's shape.
 *
 * Every one of them is about the one line the network runs — the site does not
 * say so on each notice because there is nothing else it could be about — so
 * they are all filed against it. That is what puts an alteration on the stops
 * of L1 rather than nowhere.
 *
 * A post is dropped rather than half-read: without a link there is nothing to
 * send a reader to, and without a headline there is nothing to show them.
 */
export const parseWordPressAlerts = (
  posts: WordPressPost[] | undefined,
): ScrapedAlert[] => {
  const alerts = new Map<string, ScrapedAlert>();

  (posts ?? []).forEach((post) => {
    const url = ownLink(post.link?.trim());
    if (!url) return;

    const id = alertId(url.href, post.slug);
    const title = clean(decodeEntities(post.title?.rendered ?? ''));
    if (!id || !title) return;

    alerts.set(id, {
      id,
      title,
      url: url.href,
      // WordPress dates its own posts, in the site's timezone and to the
      // second. The day is all an alteration is announced on.
      date: post.date?.slice(0, 10) ?? post.date_gmt?.slice(0, 10),
      lines: [TRAM_LINE_ID],
    });
  });

  return [...alerts.values()];
};

/** The words of one notice, where the API handed them over with the listing. */
export const postArticle = (post: WordPressPost | undefined): string =>
  post?.content?.rendered ? articleText(post.content.rendered) : '';

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
