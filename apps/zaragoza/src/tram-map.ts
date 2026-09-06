import * as cheerio from 'cheerio';

import { inZaragoza, Point, round5 } from './geo';

/**
 * The pages the operator draws its line on.
 *
 * The line page first, because that is the one whose subject is the route; the
 * front page after it, because a site that has one map has it there too. Both
 * are read on an update and the best shape of the two is kept, so a redesign
 * that moves the map costs nothing as long as it stays on one of them.
 */
export const tramMapPages = (site: string): string[] => [
  `${site}/nuestra-linea/`,
  `${site}/`,
];

/**
 * A run of at least this many points is a drawn line rather than a scattering
 * of markers. The route is twelve kilometres of kerb: a widget drawing it
 * carries it in the hundreds of points, and the twenty-five stops never come
 * through as one uninterrupted run.
 */
const minPathPoints = 12;

/**
 * How much punctuation may sit between two points of the same run.
 *
 * `},{` and `,` are what separates the points of a path; a marker carries its
 * title, its icon and its click handler between one point and the next, which
 * is far more than this. It is the whole discriminator between the line and
 * the pins, so it is deliberately mean.
 */
const maxSeparator = 24;

/**
 * What ends a run whatever its length.
 *
 * A list closes with `]` and a statement with `;`, so two shapes written one
 * after another are two shapes even where only three characters separate
 * them. Without this, a page that draws its route beside an outline of the
 * city yields one run that is neither.
 */
const runEnd = /[\];]/;

/**
 * One point, in the notations a Google Maps widget writes them in.
 *
 * Three shapes, and all three turn up in the wild on the same kind of page: a
 * constructed `LatLng`, an object literal written by hand, and the same object
 * as JSON from a plugin. Latitude first in every one of them — Google's order,
 * which is the reverse of the one everything else here uses.
 */
const pointPatterns = [
  // new google.maps.LatLng(41.68716, -0.90197)
  /(?:new\s+)?(?:google\.maps\.)?LatLng\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/g,
  // { lat: 41.68716, lng: -0.90197 } and its quoted and `lon` spellings
  /["']?lat["']?\s*:\s*(-?\d+\.\d+)\s*,\s*["']?(?:lng|lon|longitude)["']?\s*:\s*(-?\d+\.\d+)/g,
];

interface FoundPoint {
  point: Point;
  start: number;
  end: number;
}

/** Every point in one piece of script, in the order it is written. */
const pointsIn = (script: string): FoundPoint[] =>
  pointPatterns
    .flatMap((pattern) =>
      [...script.matchAll(pattern)].map((match) => ({
        // Latitude first as the widget writes it, longitude first as this
        // service stores it.
        point: [round5(Number(match[2])), round5(Number(match[1]))] as Point,
        start: match.index,
        end: match.index + match[0].length,
      })),
    )
    .filter(({ point }) => inZaragoza(point))
    .sort((a, b) => a.start - b.start);

/**
 * The runs of points a piece of script draws.
 *
 * A path is written as its points one after another with nothing between them
 * but punctuation; anything else on a map — a marker, a bounds, a centre — is
 * a point with a paragraph of configuration around it. So the points are read
 * in the order they are written and cut wherever the gap between two of them
 * is too wide to be a comma.
 */
export const scriptPaths = (script: string): number[][][] => {
  const runs: FoundPoint[][] = [];
  let run: FoundPoint[] = [];
  let previous: FoundPoint | undefined;

  pointsIn(script).forEach((found) => {
    // Two patterns can match the same text; the second one to reach a point
    // already read is not a new point.
    if (previous && found.start < previous.end) return;
    const between = previous ? script.slice(previous.end, found.start) : '';
    if (previous && (between.length > maxSeparator || runEnd.test(between))) {
      runs.push(run);
      run = [];
    }
    run.push(found);
    previous = found;
  });
  runs.push(run);

  return runs
    .filter((points) => points.length >= minPathPoints)
    .map((points) => points.map(({ point }) => point));
};

/**
 * The line the page's map widget draws, if it draws one.
 *
 * Read from the page's own scripts, which is where a Google Maps widget puts
 * its geometry: the map is built in the browser, so whatever it draws has to
 * be in the document by the time it loads. The longest run wins — a page with
 * a route on it has one long shape and a handful of short ones, and the long
 * one is the route.
 */
export const parseMapPath = (html: string): number[][] => {
  const $ = cheerio.load(html);
  const paths = $('script')
    .toArray()
    .flatMap((el) => scriptPaths($(el).text()));

  return paths.sort((a, b) => b.length - a.length)[0] ?? [];
};

const dataFile = /\.(kml|kmz|geojson|json)$/i;

/**
 * The map files the page points at, for a widget that fetches its shape rather
 * than carrying it.
 *
 * Only files on the operator's own site: the page is scanned whole and
 * whatever this returns gets fetched, so a third-party script's own asset URL
 * is not something to go and ask for.
 */
export const mapDataLinks = (html: string, pageUrl: string): string[] => {
  const host = new URL(pageUrl).host;
  const links = new Set<string>();

  for (const [, raw] of html.matchAll(/["'](https?:\/\/[^"'\s]+)["']/g)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.host !== host) continue;
    if (!dataFile.test(url.pathname)) continue;
    links.add(url.href);
  }

  return [...links];
};
