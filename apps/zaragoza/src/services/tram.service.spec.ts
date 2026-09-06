import { HttpService } from '@nestjs/axios';
import { createCache } from 'cache-manager';
import { AnyBulkWriteOperation, Model } from 'mongoose';
import { of, throwError } from 'rxjs';

import {
  TramAlert,
  TramAlertDocument,
  TramLine,
  TramLineDocument,
  TramStation,
  TramStationDocument,
} from '../schemas/tram.schema';
import { TramService } from './tram.service';
import { AlertDetails, AlertReader } from '../alert-reader';
import { tramIncidentsURL } from '../tram-alerts';
import { TramStationResponse } from '../models/tram.interface';

/** The stop, as the service answers when it has one to answer with. */
const stop = (resp: unknown) => resp as TramStationResponse;

const site = 'https://www.tranviasdezaragoza.es';
const categoriesUrl = `${site}/wp-json/wp/v2/categories`;
const postsUrl = `${site}/wp-json/wp/v2/posts`;

/** Five stops of the corridor, north to south, two platforms apiece. */
const corridor: [string, string, number, number][] = [
  ['112', 'Parque Goya', -0.90197, 41.68716],
  ['113', 'Adolfo Aznar', -0.89959, 41.68172],
  ['114', 'Margarita Xirgu', -0.89523, 41.67318],
  ['115', 'Legaz Lacambra', -0.89224, 41.66702],
  ['116', 'Clara Campoamor', -0.88938, 41.66104],
];

const storedStations = (rows = corridor): Partial<TramStation>[] =>
  rows.flatMap(([key, street, lon, lat]) => [
    {
      id: `${key}1`,
      street,
      lines: [],
      coordinates: [`${lon}`, `${lat}`],
      type: 'tram',
    },
    {
      id: `${key}2`,
      street,
      lines: [],
      coordinates: [`${lon + 0.0001}`, `${lat}`],
      type: 'tram',
    },
  ]);

/** The line page, with the route drawn into its map widget's script. */
const mapPage = (rows = corridor) => {
  const points = rows.flatMap(([, , lon, lat], index) => {
    const next = rows[index + 1];
    return next
      ? [
          [lon, lat],
          [(lon + next[2]) / 2, (lat + next[3]) / 2],
        ]
      : [[lon, lat]];
  });
  // Padded out to the length a real drawn route has, by walking the last leg
  // in smaller steps: a run too short to be a route is not read as one.
  const [lastLon, lastLat] = points[points.length - 1];
  const tail = Array.from({ length: 12 }, (_, i) => [
    lastLon + (i + 1) * 0.0002,
    lastLat - (i + 1) * 0.0002,
  ]);
  return `<html><body><div id="map"></div><script>
      var route = new google.maps.Polyline({path: [${[...points, ...tail]
        .map(([lon, lat]) => `{lat: ${lat}, lng: ${lon}}`)
        .join(',')}]});
    </script></body></html>`;
};

const linePageUrl = `${site}/nuestra-linea/`;

const wpPost = (slug: string, title: string, date = '2026-09-04T10:12:31') => ({
  slug,
  link: `${site}/${slug}/`,
  date,
  title: { rendered: title },
  content: { rendered: `<p>${title}. Del 4 al 6 de septiembre.</p>` },
});

const httpError = (status: number) => {
  const error: Error & { response?: { status: number } } = new Error(
    `Request failed with status code ${status}`,
  );
  error.response = { status };
  return error;
};

const applyUpdate = <T>(doc: T, update: Record<string, unknown>): T => {
  Object.entries(update).forEach(([key, value]) => {
    if (value !== undefined) doc[key] = value;
  });
  return doc;
};

class FakeModel<T extends { id: string }> {
  constructor(public docs: T[] = []) {}

  find() {
    const chain = {
      sort: () => chain,
      lean: () => chain,
      exec: async () => this.docs.map((doc) => ({ ...doc })),
    };
    return chain;
  }

  findOne(filter: { id: string }) {
    const doc = this.docs.find((item) => item.id === filter.id);
    return { lean: async () => (doc ? { ...doc } : null) };
  }

  async deleteMany(filter: { id: { $in: string[] } }) {
    const going = new Set(filter.id.$in);
    const before = this.docs.length;
    this.docs = this.docs.filter((doc) => !going.has(doc.id));
    return { deletedCount: before - this.docs.length };
  }

  async bulkWrite(operations: AnyBulkWriteOperation[]) {
    operations.forEach((operation) => {
      const { filter, update } = (
        operation as {
          updateOne: {
            filter: { id: string };
            update: { $set: Record<string, unknown> };
          };
        }
      ).updateOne;
      const doc =
        this.docs.find((item) => item.id === filter.id) ??
        this.docs[this.docs.push({ id: filter.id } as T) - 1];
      applyUpdate(doc, update.$set);
    });
    return { modifiedCount: operations.length };
  }
}

const fakeReader = (details?: Record<string, AlertDetails>) =>
  ({
    enabled: !!details,
    read: jest.fn(async (alert) => details?.[alert.id]),
  }) as unknown as AlertReader & { read: jest.Mock };

const build = (
  options: {
    stations?: Partial<TramStation>[];
    lines?: Partial<TramLine>[];
    alerts?: Partial<TramAlert>[];
    /** The categories the site's REST API answers with. */
    categories?: { id: number; slug: string }[];
    /** The posts filed under them. */
    posts?: ReturnType<typeof wpPost>[];
    /** The incidents page, for a site whose REST API is shut. */
    incidentsPage?: string;
    /** Any other URL a source serves, already decoded as axios would. */
    pages?: Record<string, unknown>;
    /** URLs the site answers with a server error. */
    unreachable?: string[];
    articles?: Record<string, AlertDetails>;
  } = {},
) => {
  const stationModel = new FakeModel<TramStation>(
    (options.stations ?? []) as TramStation[],
  );
  const lineModel = new FakeModel<TramLine>(
    (options.lines ?? []) as TramLine[],
  );
  const alertModel = new FakeModel<TramAlert>(
    (options.alerts ?? []) as TramAlert[],
  );

  const httpService = {
    get: jest.fn((url: string) => {
      if (options.unreachable?.some((blocked) => url.startsWith(blocked))) {
        return throwError(() => httpError(500));
      }
      if (url.startsWith(categoriesUrl)) {
        return options.categories
          ? of({ data: options.categories })
          : throwError(() => httpError(404));
      }
      if (url.startsWith(postsUrl)) {
        return of({ data: options.posts ?? [] });
      }
      if (url === tramIncidentsURL && options.incidentsPage) {
        return of({ data: options.incidentsPage });
      }
      if (options.pages && url in options.pages) {
        return of({ data: options.pages[url] });
      }
      return throwError(() => httpError(404));
    }),
  } as unknown as HttpService;

  const reader = fakeReader(options.articles);
  const service = new TramService(
    createCache(),
    stationModel as unknown as Model<TramStationDocument>,
    lineModel as unknown as Model<TramLineDocument>,
    alertModel as unknown as Model<TramAlertDocument>,
    httpService,
    reader,
  );

  return { service, stationModel, lineModel, alertModel, httpService, reader };
};

describe('getLinesUpdate', () => {
  it('builds the line from the stops it holds', async () => {
    const { service } = build({ stations: storedStations() });

    const resp = await service.getLinesUpdate();

    expect(Object.keys(resp)).toEqual(['L1']);
    expect(resp['L1'].name).toBe('Parque Goya - Clara Campoamor');
    expect(resp['L1'].stations).toEqual([
      '1121',
      '1131',
      '1141',
      '1151',
      '1161',
    ]);
    expect(resp['L1'].hidden).toBe(false);
  });

  it('publishes the return leg on the far platform of each stop', async () => {
    const { service } = build({ stations: storedStations() });

    await service.getLinesUpdate();

    // Asked for by id, which is the only way the drawn shape is served.
    const line = await service.getLine('L1');
    expect(line.stationsReturn).toEqual([
      '1162',
      '1152',
      '1142',
      '1132',
      '1122',
    ]);
    expect(line.path).toHaveLength(5);
    expect(line.pathReturn).toHaveLength(5);
  });

  it('leaves the drawn shape out of the listing of every line', async () => {
    const { service } = build({ stations: storedStations() });

    const resp = await service.getLinesUpdate();

    expect(resp['L1'].path).toBeUndefined();
    expect(resp['L1'].pathReturn).toBeUndefined();
  });

  it('tells each stop which line calls at it', async () => {
    const { service, stationModel } = build({ stations: storedStations() });

    await service.getLinesUpdate();

    expect(stationModel.docs.every((doc) => doc.lines.includes('L1'))).toBe(
      true,
    );
  });

  it('leaves out a stop that belongs to another line', async () => {
    const { service } = build({
      stations: [
        ...storedStations().map((station) => ({ ...station, lines: ['L1'] })),
        // Belonging to another line is the one thing a stop can say that
        // keeps it off this one. A stop that says nothing is a stop no run
        // has placed yet, and is offered — see below.
        {
          id: '9991',
          street: 'Cocheras',
          lines: ['L2'],
          coordinates: ['-0.95', '41.62'],
        },
      ],
    });

    const resp = await service.getLinesUpdate();

    expect(resp['L1'].stations).not.toContain('9991');
  });

  it('leaves out a stop the drawn route does not pass', async () => {
    const { service } = build({
      stations: [
        ...storedStations(),
        // Nothing on the record says this is not on the line; the route says
        // it, by not going anywhere near it.
        {
          id: '9991',
          street: 'Cocheras',
          lines: [],
          coordinates: ['-0.95', '41.62'],
        },
      ],
      pages: { [linePageUrl]: mapPage() },
    });

    const resp = await service.getLinesUpdate();

    expect(resp['L1'].stations).not.toContain('9991');
  });

  it('drops a stored line this network no longer runs', async () => {
    const { service, lineModel } = build({
      stations: storedStations(),
      // What an update under the old name left behind: the same line, under
      // an id nothing uses now.
      lines: [
        {
          id: '1',
          name: 'Parque Goya - Clara Campoamor',
          stations: ['1121'],
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
      ],
    });

    const resp = await service.getLinesUpdate();

    expect(Object.keys(resp)).toEqual(['L1']);
    expect(lineModel.docs.map((doc) => doc.id)).toEqual(['L1']);
  });

  it('stops a station carrying a line id the network has dropped', async () => {
    const { service, stationModel } = build({
      stations: storedStations().map((station) => ({
        ...station,
        lines: ['1'],
      })),
    });

    await service.getLinesUpdate();

    // The lines at a stop are the ones this run built, not those added to
    // whatever was stored — which is what would have kept `1` there for good.
    expect(stationModel.docs.map((doc) => doc.lines)).toEqual(
      stationModel.docs.map(() => ['L1']),
    );
  });

  it('offers a stop that no run has placed back to the line', async () => {
    const { service, stationModel } = build({
      stations: storedStations().map((station, index) => ({
        ...station,
        // One stop left off by an earlier run; the rest already placed.
        lines: index === 4 ? [] : ['L1'],
      })),
    });

    await service.getLinesUpdate();

    expect(stationModel.docs[4].lines).toEqual(['L1']);
  });

  it('deletes nothing on a run that could not build the line', async () => {
    const { service, lineModel } = build({
      stations: [],
      lines: [
        {
          id: '1',
          name: 'Parque Goya - Clara Campoamor',
          stations: ['1121'],
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
      ],
    });

    await service.getLinesUpdate();

    // A run that read nothing is not evidence that anything is stale.
    expect(lineModel.docs.map((doc) => doc.id)).toEqual(['1']);
  });

  it('leaves the stored line alone when there are no stops to build from', async () => {
    const { service } = build({
      stations: [],
      lines: [
        {
          id: 'L1',
          name: 'Parque Goya - Valdespartera',
          stations: ['1121'],
          stationsReturn: ['1122'],
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const resp = await service.getLinesUpdate();

    expect(resp['L1'].stations).toEqual(['1121']);
    expect(resp['L1'].lastUpdated).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not restamp a line that has not changed', async () => {
    const { service, lineModel } = build({ stations: storedStations() });

    await service.getLinesUpdate();
    const first = lineModel.docs[0].lastUpdated;
    await service.getLinesUpdate();

    expect(lineModel.docs[0].lastUpdated).toBe(first);
  });
});

describe('the alterations the operator publishes', () => {
  it('stores what the site is showing', async () => {
    const { service } = build({
      stations: storedStations(),
      categories: [{ id: 4, slug: 'incidencias' }],
      posts: [wpPost('corte-en-plaza-espana', 'Corte en Plaza España')],
    });

    await service.getLinesUpdate();

    expect(await service.getAlerts()).toEqual([
      expect.objectContaining({
        id: 'corte-en-plaza-espana',
        title: 'Corte en Plaza España',
        url: `${site}/corte-en-plaza-espana/`,
        date: '2026-09-04',
        lines: ['L1'],
        scope: 'line',
      }),
    ]);
  });

  it('reads the incidents page when the REST API is shut', async () => {
    const { service } = build({
      stations: storedStations(),
      // No categories: the API answers 404.
      incidentsPage: `<article class="post">
          <h2 class="entry-title">
            <a href="${site}/obras-en-la-via/">Obras en la vía</a>
          </h2>
          <time datetime="2026-09-05T08:00:00+02:00">5 septiembre</time>
        </article>`,
    });

    await service.getLinesUpdate();

    expect((await service.getAlerts())[0]).toEqual(
      expect.objectContaining({ id: 'obras-en-la-via', date: '2026-09-05' }),
    );
  });

  it('leaves the stored alerts alone when neither road answers', async () => {
    const { service } = build({
      stations: storedStations(),
      alerts: [
        {
          id: 'corte',
          title: 'Corte',
          url: `${site}/corte/`,
          date: '2026-09-01',
          lines: ['L1'],
          stations: [],
          addedStations: [],
          scope: 'line',
          firstSeen: '2026-09-01T00:00:00.000Z',
        },
      ],
      unreachable: [site],
    });

    await service.getLinesUpdate();

    expect((await service.getAlerts()).map((alert) => alert.id)).toEqual([
      'corte',
    ]);
  });

  it('drops an alteration the site has stopped showing', async () => {
    const { service, alertModel } = build({
      stations: storedStations(),
      alerts: [
        {
          id: 'ya-terminado',
          title: 'Ya terminado',
          url: `${site}/ya-terminado/`,
          lines: ['L1'],
          stations: [],
          addedStations: [],
          scope: 'line',
          firstSeen: '2026-08-01T00:00:00.000Z',
        },
      ],
      categories: [{ id: 4, slug: 'incidencias' }],
      posts: [wpPost('corte', 'Corte')],
    });

    await service.getLinesUpdate();

    expect(alertModel.docs.map((doc) => doc.id)).toEqual(['corte']);
  });

  it('reads the notice the listing handed over, without fetching it again', async () => {
    const { service, reader, httpService } = build({
      stations: storedStations(),
      categories: [{ id: 4, slug: 'incidencias' }],
      posts: [wpPost('corte', 'Corte en Margarita Xirgu')],
      articles: {
        corte: {
          startDate: '2026-09-04',
          endDate: '2026-09-06',
          stations: ['1141'],
          addedStations: [],
          scope: 'stations',
        },
      },
    });

    await service.getLinesUpdate();

    // The stops of the line, in route order and named by their street: what
    // "entre Margarita Xirgu y Legaz Lacambra" has to be resolved against.
    expect(reader.read).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'corte' }),
      expect.stringContaining('Del 4 al 6 de septiembre'),
      [
        expect.objectContaining({
          line: 'L1',
          stations: expect.arrayContaining([
            { id: '1141', street: 'Margarita Xirgu' },
          ]),
        }),
      ],
      'tram',
    );
    // The words came with the listing, so the notice itself is never fetched.
    expect(
      (httpService.get as jest.Mock).mock.calls.map(([url]) => url),
    ).not.toContain(`${site}/corte/`);

    expect((await service.getAlerts())[0]).toEqual(
      expect.objectContaining({
        endDate: '2026-09-06',
        stations: ['1141'],
        scope: 'stations',
      }),
    );
  });

  it('offers both platforms of a stop to the reader', async () => {
    const { service, reader } = build({
      stations: storedStations(),
      categories: [{ id: 4, slug: 'incidencias' }],
      posts: [wpPost('corte', 'Corte')],
      articles: {},
    });

    await service.getLinesUpdate();

    const [, , routes] = reader.read.mock.calls[0];
    // A notice names a place; which of its two platforms it means is not
    // something the words settle, so both are on offer — each of them once.
    const ids = routes[0].stations.map((station) => station.id);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids).toEqual(expect.arrayContaining(['1141', '1142']));
  });
});

describe('a stop and what is altered on it', () => {
  const boardUrl = (id: string) =>
    `https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia/${id}`;

  // The city's board for every platform on the corridor, so that asking about
  // a stop is about the alterations on it rather than about the arrivals.
  const boards = Object.fromEntries(
    corridor.flatMap(([key, street]) =>
      ['1', '2'].map((platform) => [
        boardUrl(`${key}${platform}`),
        {
          destinos: [{ linea: '1', destino: street.toUpperCase(), minutos: 4 }],
        },
      ]),
    ),
  );

  const onTheLine = (alerts: Partial<TramAlert>[]) =>
    build({
      stations: storedStations().map((station) => ({
        ...station,
        lines: ['L1'],
      })),
      alerts,
      pages: boards,
    });

  const alert = (extra: Partial<TramAlert>): Partial<TramAlert> => ({
    title: 'Alteración',
    url: `${site}/${extra.id}/`,
    date: '2026-09-01',
    lines: ['L1'],
    stations: [],
    addedStations: [],
    scope: 'line',
    firstSeen: '2026-09-01T00:00:00.000Z',
    ...extra,
  });

  it('shows the alterations in force on the line it is on', async () => {
    const { service } = onTheLine([alert({ id: 'corte' })]);

    expect(stop(await service.getStation('1141')).alerts).toEqual([
      expect.objectContaining({ id: 'corte', direct: false }),
    ]);
  });

  it('marks the stop a notice names as one it names', async () => {
    const { service } = onTheLine([
      alert({ id: 'suprimida', stations: ['1141'], scope: 'stations' }),
    ]);

    expect(stop(await service.getStation('1141')).alerts).toEqual([
      expect.objectContaining({ id: 'suprimida', direct: true }),
    ]);
    // Narrowed to that stop, so the one down the line shows nothing.
    expect(stop(await service.getStation('1151')).alerts).toEqual([]);
  });

  it('calls the line what the network calls it, not what the feed does', async () => {
    const { service } = onTheLine([]);

    const answered = stop(await service.getStation('1141'));

    // The city's board says `1`; the line list says `L1`. A client matching
    // an arrival to a line has to be given the same id by both.
    expect(answered.times.map((time) => time.line)).toEqual(['L1', 'L1']);
  });

  it('still answers with the stop when it has no alterations at all', async () => {
    const { service } = onTheLine([]);

    const answered = stop(await service.getStation('1141'));
    expect(answered.alerts).toEqual([]);
    expect(answered.times).toHaveLength(2);
  });
});

describe('getLine', () => {
  it('answers 404 for a line the network does not run', async () => {
    const { service } = build({ stations: storedStations() });

    await service.getLinesUpdate();

    await expect(service.getLine('L2')).rejects.toMatchObject({
      response: { statusCode: 404 },
    });
  });
});

describe("the route the operator's map draws", () => {
  it('draws the line with it, and orders the stops by it', async () => {
    const { service } = build({
      stations: storedStations(),
      pages: { [linePageUrl]: mapPage() },
    });

    await service.getLinesUpdate();
    const line = await service.getLine('L1');

    // Longer than the five stops: this is the track, not the stops joined up.
    expect(line.path.length).toBeGreaterThan(5);
    expect(line.pathReturn).toEqual([...line.path].reverse());
    expect(line.stations).toEqual(['1121', '1131', '1141', '1151', '1161']);
  });

  it('draws the line through its stops when no page carries a route', async () => {
    const { service } = build({ stations: storedStations() });

    await service.getLinesUpdate();
    const line = await service.getLine('L1');

    expect(line.path).toHaveLength(5);
  });

  it('reads a route from a map file the page points at', async () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><LineString>
        <coordinates>${corridor
          .map(([, , lon, lat]) => `${lon},${lat},0.0`)
          .join(' ')}</coordinates>
      </LineString></Placemark></Document></kml>`;

    const { service } = build({
      stations: storedStations(),
      pages: {
        [linePageUrl]: `<html><body><script>
            map.load("${site}/wp-content/uploads/linea1.kml");
          </script></body></html>`,
        [`${site}/wp-content/uploads/linea1.kml`]: kml,
      },
    });

    await service.getLinesUpdate();
    const line = await service.getLine('L1');

    expect(line.path).toEqual(corridor.map(([, , lon, lat]) => [lon, lat]));
  });

  it('costs the update nothing when the map cannot be read', async () => {
    const { service } = build({
      stations: storedStations(),
      unreachable: [site],
    });

    const resp = await service.getLinesUpdate();

    // The line is still built, from the stops, exactly as before.
    expect(resp['L1'].stations).toHaveLength(5);
  });
});
