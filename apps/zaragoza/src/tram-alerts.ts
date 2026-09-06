import * as cheerio from 'cheerio';

import { articleText, parseAlertDate, ScrapedAlert } from './alerts';
import { TRAM_LINE_ID } from './tram-line';

/**
 * The tram operator's site, which is where the network's alterations are
 * published. The bus alterations come from the bus operator's site; these come
 * from this one, and the two have nothing in common but being WordPress.
 */
export const tramSiteURL = 'https://www.tranviasdezaragoza.es';

/** The page a traveller is sent to, and the one this falls back to reading. */
export const tramIncidentsURL = `${tramSiteURL}/incidencias/`;

const wpApiURL = `${tramSiteURL}/wp-json/wp/v2`;

/**
 * The categories an alteration is filed under, in the order they are tried.
 *
 * The site files its incidents somewhere; which slug it uses is the site's
 * business and has changed before on the bus side. Asking for several at once
 * costs one request and survives a rename that would otherwise silently empty
 * the listing — WordPress ignores the slugs it does not have.
 */
const alertCategorySlugs = ['incidencias', 'avisos', 'alteraciones'];

/**
 * How many notices back a listing is read.
 *
 * What is on the listing is what the operator is still showing, and an
 * alteration that is over comes off it; a page of fifty is well past the point
 * where the rest is history rather than news.
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
  excerpt?: { rendered?: string };
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
  `${wpApiURL}/categories?slug=${alertCategorySlugs.join(',')}&per_page=${alertCategorySlugs.length}&_fields=id,slug`;

export const postsQuery = (categoryIds: number[]) =>
  `${wpApiURL}/posts?categories=${categoryIds.join(',')}&per_page=${maxTramAlerts}&_fields=slug,link,date,title,content`;

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
 * The alterations the REST API lists, in this service's shape.
 *
 * Every one of them is about the one line the network runs — the site does not
 * say so on each notice because there is nothing else it could be about — so
 * they are all filed against it. That is what puts an alteration on the stops
 * of line 1 rather than nowhere.
 *
 * A post is dropped rather than half-read: without a link there is nothing to
 * send a reader to, and without a headline there is nothing to show them.
 */
export const parseWordPressAlerts = (
  posts: WordPressPost[] | undefined,
): ScrapedAlert[] => {
  const alerts = new Map<string, ScrapedAlert>();

  (posts ?? []).forEach((post) => {
    const link = post.link?.trim();
    if (!link) return;
    // Somebody else's HTML: a notice is a post on this site, and a link
    // anywhere else is not one.
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return;
    }
    if (url.host !== new URL(tramSiteURL).host) return;

    const id = alertId(link, post.slug);
    const title = clean(decodeEntities(post.title?.rendered ?? ''));
    if (!id || !title) return;

    url.hash = '';
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
 * The alterations a listing page shows, for a site whose REST API is shut.
 *
 * Read from the markup WordPress themes agree on rather than this theme's own
 * classes: a post is an `<article>` (or something classed `post`), its
 * headline is the first heading in it, and its date is a `<time>`. A theme
 * that departs from all three yields nothing here, which leaves the stored
 * alerts exactly as they were.
 */
export const parseIncidentListing = (
  html: string,
  pageUrl: string = tramIncidentsURL,
): ScrapedAlert[] => {
  const $ = cheerio.load(html);
  const alerts = new Map<string, ScrapedAlert>();
  const host = new URL(pageUrl).host;

  const entries = $('article, .post, .type-post').toArray();

  entries.forEach((element) => {
    const entry = $(element);
    const anchor = entry
      .find('h1 a[href], h2 a[href], h3 a[href], .entry-title a[href]')
      .first();
    const href = anchor.attr('href');
    if (!href) return;

    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (url.host !== host) return;
    url.hash = '';

    const id = alertId(url.href);
    const title = clean(anchor.text());
    if (!id || !title) return;

    // A machine-readable date where the theme prints one, and the words it
    // shows a reader where it does not.
    const time = entry.find('time[datetime]').first().attr('datetime');
    const printed = clean(
      entry.find('time, .entry-date, .published, .post-date').first().text(),
    );

    alerts.set(id, {
      id,
      title,
      url: url.href,
      date: time?.slice(0, 10) ?? parseAlertDate(printed),
      lines: [TRAM_LINE_ID],
    });
  });

  return [...alerts.values()];
};
