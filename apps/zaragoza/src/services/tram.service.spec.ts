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
import { dayFrom } from '../alert-store';
import { AlertDetails, AlertReader } from '../alert-reader';
import { tramFrontPageURL } from '../tram-alerts';
import { TramStationResponse } from '../models/tram.interface';

/** The stop, as the service answers when it has one to answer with. */
const stop = (resp: unknown) => resp as TramStationResponse;

const site = 'https://www.tranviasdezaragoza.es';
// The site serves the REST API under `/api/`, not `/wp-json/`.
const categoriesUrl = `${site}/api/wp/v2/categories`;
const postsUrl = `${site}/api/wp/v2/posts`;

const ajaxUrl = `${site}/wp-admin/admin-ajax.php`;

/**
 * Four places of the corridor, as the operator's own feed gives them: a stop
 * each way at each, paired by `sibling_id`, in the order each direction runs
 * them. The second is a place the two directions call at under different
 * names, as seven of this line's places really do.
 */
const corridor: [string, string, string, string, number, number][] = [
  ['2502', 'Mago de Oz', '2501', 'Mago de Oz', 41.62435, -0.93694],
  [
    '2402',
    'Un Americano en París',
    '2401',
    'Cantando bajo la Lluvia',
    41.63,
    -0.93,
  ],
  ['1902', 'Casablanca', '1901', 'Casablanca', 41.64, -0.92],
  [
    '0102',
    'Avenida de la Academia',
    '0101',
    'Avenida de la Academia',
    41.68832,
    -0.87074,
  ],
];

const operatorLine = (rows = corridor) => ({
  stops_0: rows.map(([code, name, , , lat, lon], index) => ({
    id: index + 1,
    name: code,
    displayName: name,
    lat: `${lat}`,
    lng: `${lon}`,
    position: index + 1,
    sibling_id: 100 + index,
  })),
  stops_1: [...rows].reverse().map(([, , code, name, lat, lon], index) => ({
    id: 100 + (rows.length - 1 - index),
    name: code,
    displayName: name,
    lat: `${lat}`,
    lng: `${lon}`,
    position: index + 1,
    sibling_id: rows.length - index,
  })),
  points_0: rows.map(([, , , , lat, lon]) => [`${lat}`, `${lon}`]),
  points_1: [...rows]
    .reverse()
    .map(([, , , , lat, lon]) => [`${lat}`, `${lon}`]),
});

/** The stop records an earlier run left behind. */
const storedStations = (rows = corridor): Partial<TramStation>[] =>
  rows.flatMap(([out, name, back, , lat, lon]) => [
    { id: out, street: name, lines: ['L1'], coordinates: [`${lon}`, `${lat}`] },
    {
      id: back,
      street: name,
      lines: ['L1'],
      coordinates: [`${lon}`, `${lat}`],
    },
  ]);

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
    /** The block at the top of the front page, when one is in force. */
    frontPage?: string;
    /** The line the operator publishes; absent means it published none. */
    line?: ReturnType<typeof operatorLine> | null;
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

  const line = options.line === undefined ? operatorLine() : options.line;

  const httpService = {
    post: jest.fn((url: string, body: string) => {
      if (url !== ajaxUrl) return throwError(() => httpError(404));
      if (options.unreachable?.some((blocked) => url.startsWith(blocked))) {
        return throwError(() => httpError(500));
      }
      const action = new URLSearchParams(body).get('action');
      if (action === 'dosnet_tranvias_get_nonce') {
        return of({ data: { success: true, data: 'test-nonce' } });
      }
      // The endpoint answers 403 to a request that carries no nonce.
      if (!new URLSearchParams(body).get('_ajax_nonce')) {
        return throwError(() => httpError(403));
      }
      return line
        ? of({ data: line })
        : of({ data: { stops_0: [], stops_1: [] } });
    }),
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
      if (url === tramFrontPageURL) {
        return options.frontPage
          ? of({ data: options.frontPage })
          : throwError(() => httpError(404));
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
  it('takes the line the operator publishes', async () => {
    const { service } = build();

    const resp = await service.getLinesUpdate();

    expect(Object.keys(resp)).toEqual(['L1']);
    expect(resp['L1'].name).toBe('Mago de Oz - Avenida de la Academia');
    expect(resp['L1'].stations).toEqual(['2502', '2402', '1902', '0102']);
    expect(resp['L1'].hidden).toBe(false);
  });

  it('publishes the return leg as its own run of stops', async () => {
    const { service } = build();

    await service.getLinesUpdate();
    const line = await service.getLine('L1');

    // Not the outbound list reversed: at the far end the two directions call
    // at different places altogether.
    expect(line.stationsReturn).toEqual(['0101', '1901', '2401', '2501']);
    expect(line.path).toHaveLength(4);
    expect(line.pathReturn).toEqual([...line.path].reverse());
  });

  it('leaves the drawn shape out of the listing of every line', async () => {
    const { service } = build();

    const resp = await service.getLinesUpdate();

    expect(resp['L1'].path).toBeUndefined();
    expect(resp['L1'].pathReturn).toBeUndefined();
  });

  it('calls a stop by both names where the two directions differ', async () => {
    const { service, stationModel } = build({ stations: [] });

    await service.getLinesUpdate();
    const byId = new Map(stationModel.docs.map((doc) => [doc.id, doc]));

    // Both stops of the split place carry both names, so a traveller reading
    // either is told where they are whichever way they are going.
    expect(byId.get('2402').street).toBe(
      'Cantando bajo la Lluvia / Un Americano en París',
    );
    expect(byId.get('2401').street).toBe(
      'Cantando bajo la Lluvia / Un Americano en París',
    );
    expect(byId.get('1902').street).toBe('Casablanca');
  });

  it('tells each stop which line calls at it', async () => {
    const { service, stationModel } = build({ stations: [] });

    await service.getLinesUpdate();

    expect(stationModel.docs).toHaveLength(8);
    expect(stationModel.docs.every((doc) => doc.lines.includes('L1'))).toBe(
      true,
    );
  });

  it('takes the line off a stop the operator no longer runs to', async () => {
    const { service, stationModel } = build({
      stations: [
        ...storedStations(),
        { id: '9999', street: 'Cocheras', lines: ['L1'], coordinates: [] },
      ],
    });

    await service.getLinesUpdate();

    const cocheras = stationModel.docs.find((doc) => doc.id === '9999');
    // Its record stays — it may still be asked for by id — but it stops
    // claiming a line that does not call there.
    expect(cocheras.lines).toEqual([]);
  });

  it('drops a stored line this network no longer runs', async () => {
    const { service, lineModel } = build({
      lines: [
        {
          id: '1',
          name: 'Mago de Oz - Avenida de la Academia',
          stations: ['2502'],
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
      ],
    });

    const resp = await service.getLinesUpdate();

    expect(Object.keys(resp)).toEqual(['L1']);
    expect(lineModel.docs.map((doc) => doc.id)).toEqual(['L1']);
  });

  it('leaves everything alone on a run that could not read the line', async () => {
    const { service, lineModel, stationModel } = build({
      line: null,
      stations: storedStations(),
      lines: [
        {
          id: '1',
          name: 'Mago de Oz - Avenida de la Academia',
          stations: ['2502'],
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
      ],
    });

    const resp = await service.getLinesUpdate();

    // A run that read nothing is not evidence that anything is stale.
    expect(lineModel.docs.map((doc) => doc.id)).toEqual(['1']);
    expect(resp['1'].stations).toEqual(['2502']);
    expect(stationModel.docs.every((doc) => doc.lines.includes('L1'))).toBe(
      true,
    );
  });

  it('does not restamp a line that has not changed', async () => {
    const { service, lineModel } = build();

    await service.getLinesUpdate();
    const first = lineModel.docs[0].lastUpdated;
    await service.getLinesUpdate();

    expect(lineModel.docs[0].lastUpdated).toBe(first);
  });

  it('will not ask for the line without the nonce the endpoint demands', async () => {
    const { service, httpService } = build();

    await service.getLinesUpdate();

    const asked = (httpService.post as jest.Mock).mock.calls.map(([, body]) =>
      new URLSearchParams(body).get('action'),
    );
    expect(asked).toEqual([
      'dosnet_tranvias_get_nonce',
      'dosnet_tranvias_lineas',
    ]);
    // And a referer, without which the endpoint answers 403.
    const [, , config] = (httpService.post as jest.Mock).mock.calls[1];
    expect(config.headers.Referer).toBe(`${site}/`);
  });
});

describe('the alterations the operator publishes', () => {
  it('stores what the site is showing', async () => {
    const { service } = build({
      stations: storedStations(),
      categories: [{ id: 10, slug: 'home' }],
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

  it('reads the block at the top when the service is altered right now', async () => {
    const { service } = build({
      stations: storedStations(),
      // No categories: nothing announced. The block still answers.
      frontPage: `<div class="tranvias_dosnet_avisos tranvias_dosnet_avisos_1">
          <div class="tranvias_dosnet_avisos_title"><h2><span>Avisos</span></h2></div>
          <div class="tranvias_dosnet_avisos_list">
            <div class="tranvias_dosnet_avisos_aviso">Servicio interrumpido</div>
          </div>
        </div>`,
    });

    await service.getLinesUpdate();

    expect((await service.getAlerts())[0]).toEqual(
      expect.objectContaining({
        title: 'Servicio interrumpido',
        lines: ['L1'],
      }),
    );
  });

  it('counts an alteration once when it is both in force and announced', async () => {
    const { service } = build({
      stations: storedStations(),
      // The block links to the post that announced it, so they are one.
      frontPage: `<div class="tranvias_dosnet_avisos_aviso">
          <a href="${site}/corte/">Corte en Plaza España</a>
        </div>`,
      categories: [{ id: 10, slug: 'home' }],
      posts: [wpPost('corte', 'Corte en Plaza España')],
    });

    await service.getLinesUpdate();
    const alerts = await service.getAlerts();

    expect(alerts.map((alert) => alert.id)).toEqual(['corte']);
    // The post's date survives the merge; the block carries none.
    expect(alerts[0].date).toBe('2026-09-04');
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
      categories: [{ id: 10, slug: 'home' }],
      posts: [wpPost('corte', 'Corte')],
    });

    await service.getLinesUpdate();

    expect(alertModel.docs.map((doc) => doc.id)).toEqual(['corte']);
  });

  it('reads the notice the listing handed over, without fetching it again', async () => {
    const { service, reader, httpService } = build({
      stations: storedStations(),
      categories: [{ id: 10, slug: 'home' }],
      posts: [wpPost('corte', 'Corte en Casablanca')],
      articles: {
        corte: {
          // Counted from today rather than written down. `getAlerts` serves
          // what is in force, so an alteration dated into a particular week
          // stops being served the morning after that week — and a test that
          // asks for it back fails on a day nobody changed anything. This one
          // did, on the 7th of September.
          startDate: dayFrom(-2),
          endDate: dayFrom(1),
          stations: ['1902'],
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
            { id: '1902', street: 'Casablanca' },
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
        endDate: dayFrom(1),
        stations: ['1902'],
        scope: 'stations',
      }),
    );
  });

  it('offers both platforms of a stop to the reader', async () => {
    const { service, reader } = build({
      stations: storedStations(),
      categories: [{ id: 10, slug: 'home' }],
      posts: [wpPost('corte', 'Corte')],
      articles: {},
    });

    await service.getLinesUpdate();

    const [, , routes] = reader.read.mock.calls[0];
    // A notice names a place; which of its two platforms it means is not
    // something the words settle, so both are on offer — each of them once.
    const ids = routes[0].stations.map((station) => station.id);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids).toEqual(expect.arrayContaining(['1902', '1901']));
  });
});

describe('a stop and what is altered on it', () => {
  const boardUrl = (id: string) =>
    `https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia/${id}`;

  // The city's board for every platform code on the corridor, so that asking
  // about a stop is about the alterations on it rather than the arrivals.
  const boards = Object.fromEntries(
    corridor.flatMap(([out, name, back]) =>
      [out, back].map((code) => [
        boardUrl(code),
        {
          destinos: [{ linea: '1', destino: name.toUpperCase(), minutos: 4 }],
        },
      ]),
    ),
  );

  const onTheLine = (alerts: Partial<TramAlert>[]) =>
    build({
      stations: storedStations(),
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

    expect(stop(await service.getStation('1902')).alerts).toEqual([
      expect.objectContaining({ id: 'corte', direct: false }),
    ]);
  });

  it('marks the stop a notice names as one it names', async () => {
    const { service } = onTheLine([
      alert({ id: 'suprimida', stations: ['1902'], scope: 'stations' }),
    ]);

    expect(stop(await service.getStation('1902')).alerts).toEqual([
      expect.objectContaining({ id: 'suprimida', direct: true }),
    ]);
    // Narrowed to that stop, so the one down the line shows nothing.
    expect(stop(await service.getStation('1901')).alerts).toEqual([]);
  });

  it('calls the line what the network calls it, not what the feed does', async () => {
    const { service } = onTheLine([]);

    const answered = stop(await service.getStation('1902'));

    // The city's board says `1`; the line list says `L1`. A client matching
    // an arrival to a line has to be given the same id by both.
    expect(answered.times.map((time) => time.line)).toEqual(['L1', 'L1']);
  });

  it('still answers with the stop when it has no alterations at all', async () => {
    const { service } = onTheLine([]);

    const answered = stop(await service.getStation('1902'));
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
