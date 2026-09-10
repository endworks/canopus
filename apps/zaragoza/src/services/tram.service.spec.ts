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
import { stopCode } from '../tram-line';
import { AlertDetails, AlertReader } from '../alert-reader';
import { tramFrontPageURL } from '../tram-alerts';
import { TramStationResponse } from '../models/tram.interface';
import type { Mock } from 'vitest';

/** The stop, as the service answers when it has one to answer with. */
const stop = (resp: unknown) => resp as TramStationResponse;

const site = 'https://www.tranviasdezaragoza.es';

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

/**
 * The stop records a run leaves: one for a place both directions call at,
 * under its pair's code with a nought for the direction, and one apiece where
 * the two directions call at different places.
 */
const storedStations = (rows = corridor): Partial<TramStation>[] =>
  rows.flatMap(([out, name, back, backName, lat, lon]) => {
    const at = [`${lon}`, `${lat}`];
    return name === backName
      ? [
          {
            id: stopCode(`${out.slice(0, -1)}0`),
            street: name,
            lines: ['L1'],
            coordinates: at,
          },
        ]
      : [
          { id: stopCode(out), street: name, lines: ['L1'], coordinates: at },
          {
            id: stopCode(back),
            street: backName,
            lines: ['L1'],
            coordinates: at,
          },
        ];
  });

/**
 * What an earlier pairing left behind: a record per platform, including ids
 * for places that were never places.
 */
const platformRecords = (rows = corridor): Partial<TramStation>[] =>
  rows.flatMap(([out, name, back, , lat, lon]) => [
    { id: out, street: name, lines: ['L1'], coordinates: [`${lon}`, `${lat}`] },
    {
      id: back,
      street: name,
      lines: ['L1'],
      coordinates: [`${lon}`, `${lat}`],
    },
  ]);

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
    read: vi.fn(async (alert) => details?.[alert.id]),
  }) as unknown as AlertReader & { read: Mock };

const build = (
  options: {
    stations?: Partial<TramStation>[];
    lines?: Partial<TramLine>[];
    alerts?: Partial<TramAlert>[];
    /** The operator's front page, which is where an alteration is shown. */
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
    post: vi.fn((url: string, body: string) => {
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
    get: vi.fn((url: string) => {
      if (options.unreachable?.some((blocked) => url.startsWith(blocked))) {
        return throwError(() => httpError(500));
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
    expect(resp['L1'].stations).toEqual(['2500', '2402', '1900', '100']);
    expect(resp['L1'].hidden).toBe(false);
  });

  it('publishes the return leg as its own run of stops', async () => {
    const { service } = build();

    await service.getLinesUpdate();
    const line = await service.getLine('L1');

    // Not the outbound list reversed: the two directions share the places
    // they both call at, and part where they do not.
    expect(line.stationsReturn).toEqual(['100', '1900', '2401', '2500']);
    expect(line.path).toHaveLength(4);
    expect(line.pathReturn).toEqual([...line.path].reverse());
  });

  it('leaves the drawn shape out of the listing of every line', async () => {
    const { service } = build();

    const resp = await service.getLinesUpdate();

    expect(resp['L1'].path).toBeUndefined();
    expect(resp['L1'].pathReturn).toBeUndefined();
  });

  it('keeps one record for a place and two where they are two', async () => {
    const { service, stationModel } = build({ stations: [] });
    const byId = new Map(stationModel.docs.map((doc) => [doc.id, doc]));

    await service.getLinesUpdate();

    expect(stationModel.docs.map((doc) => doc.id).sort()).toEqual([
      '100',
      '1900',
      '2401',
      '2402',
      '2500',
    ]);
    expect(byId).toBeDefined();
  });

  it('calls each stop of a split place its own name, not both', async () => {
    const { service, stationModel } = build({ stations: [] });

    await service.getLinesUpdate();
    const byId = new Map(stationModel.docs.map((doc) => [doc.id, doc]));

    // Two stops on two streets: a traveller at one cannot catch what calls at
    // the other, so neither wears the other's name.
    expect(byId.get('2402').street).toBe('Un Americano en París');
    expect(byId.get('2401').street).toBe('Cantando bajo la Lluvia');
    expect(byId.get('1900').street).toBe('Casablanca');
  });

  it('tells each stop which line calls at it', async () => {
    const { service, stationModel } = build({ stations: [] });

    await service.getLinesUpdate();

    expect(stationModel.docs).toHaveLength(5);
    expect(stationModel.docs.every((doc) => doc.lines.includes('L1'))).toBe(
      true,
    );
  });

  it('drops the stop records this line does not have', async () => {
    const { service, stationModel } = build({
      stations: [
        ...platformRecords(),
        { id: '9999', street: 'Cocheras', lines: ['L1'], coordinates: [] },
      ],
    });

    await service.getLinesUpdate();

    // Not emptied and kept: no board answers for any of them, so a reader
    // holding one in its cache would ask for it forever.
    expect(stationModel.docs.map((doc) => doc.id).sort()).toEqual([
      '100',
      '1900',
      '2401',
      '2402',
      '2500',
    ]);
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

    const asked = (httpService.post as Mock).mock.calls.map(([, body]) =>
      new URLSearchParams(body).get('action'),
    );
    expect(asked).toEqual([
      'dosnet_tranvias_get_nonce',
      'dosnet_tranvias_lineas',
    ]);
    // And a referer, without which the endpoint answers 403.
    const [, , config] = (httpService.post as Mock).mock.calls[1];
    expect(config.headers.Referer).toBe(`${site}/`);
  });
});

/**
 * The block the operator shows at the top of their front page while something
 * is wrong with the line, in the markup their own plugin renders.
 */
const avisos = (...notices: string[]) => `<html><body>
  <div class="tranvias_dosnet_avisos tranvias_dosnet_avisos_${notices.length}">
    <div class="tranvias_dosnet_avisos_title"><h2><span>Avisos</span></h2></div>
    <div class="tranvias_dosnet_avisos_list">
      ${notices.map((text) => `<div class="tranvias_dosnet_avisos_aviso">${text}</div>`).join('')}
    </div>
  </div>
</body></html>`;

/** A front page with no block on it: the line is running normally. */
const noAvisos = '<html><body><div id="main"></div></body></html>';

/** What the operator was showing when this was written. */
const interrupted =
  '7/9/2026 14:30:28. La afección en la línea ha sido modificada. Servicio ' +
  'interrumpido entre Campus Río Ebro y Martínez Soria / María Montessori. ' +
  'Bus alternativo activado. El resto de la línea funciona con normalidad.';

describe('the alterations the operator publishes', () => {
  it('is the block at the top of the front page, and only that', async () => {
    const { service } = build({
      stations: storedStations(),
      frontPage: avisos(interrupted),
    });

    await service.getLinesUpdate();

    expect(await service.getAlerts()).toEqual([
      expect.objectContaining({
        title: interrupted,
        url: `${site}/`,
        lines: ['L1'],
      }),
    ]);
  });

  it('is nothing at all when the block is not there', async () => {
    // Which is most days. The posts below the fold are announcements — a
    // festival timetable, works starting next month — and were being served
    // as though the line were altered now.
    const { service } = build({
      stations: storedStations(),
      frontPage: noAvisos,
    });

    await service.getLinesUpdate();

    expect(await service.getAlerts()).toEqual([]);
  });

  it('drops what it was showing once the block is gone', async () => {
    const { service, alertModel } = build({
      stations: storedStations(),
      alerts: [
        {
          id: 'ya-terminado',
          title: 'Ya terminado',
          url: `${site}/`,
          lines: ['L1'],
          stations: [],
          addedStations: [],
          scope: 'line',
          firstSeen: '2026-08-01T00:00:00.000Z',
        },
      ],
      frontPage: noAvisos,
    });

    await service.getLinesUpdate();

    // An empty block is the all-clear, and nothing else says so: these
    // notices carry no end date.
    expect(alertModel.docs).toEqual([]);
  });

  it('leaves the stored alteration alone when the page cannot be read', async () => {
    const { service } = build({
      stations: storedStations(),
      alerts: [
        {
          id: 'corte',
          title: 'Corte',
          url: `${site}/`,
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

    // A page that did not load says nothing about the service. Only a page
    // that loaded and showed no block is the all-clear.
    expect((await service.getAlerts()).map((alert) => alert.id)).toEqual([
      'corte',
    ]);
  });

  it('keeps each notice apart where the block is showing two', async () => {
    const { service } = build({
      stations: storedStations(),
      frontPage: avisos(interrupted, 'Ascensor fuera de servicio en Gran Vía'),
    });

    await service.getLinesUpdate();

    expect(
      (await service.getAlerts()).map((alert) => alert.title).sort(),
    ).toEqual([interrupted, 'Ascensor fuera de servicio en Gran Vía'].sort());
  });

  it('reads the notice out of its own words, fetching nothing', async () => {
    const { service, reader, httpService } = build({
      stations: storedStations(),
      frontPage: avisos(interrupted),
      articles: {},
    });

    await service.getLinesUpdate();

    // The block is the notice. There is no article behind it, so the words
    // handed to the reader are the ones it is showing.
    const [alert, words] = reader.read.mock.calls[0];
    expect(alert.title).toBe(interrupted);
    expect(words).toBe(interrupted);
    // And nothing was fetched but the front page itself.
    expect(
      (httpService.get as Mock).mock.calls
        .map(([url]) => url)
        .filter((url: string) => url.startsWith(site)),
    ).toEqual([tramFrontPageURL]);
  });

  it('offers the reader each place once, and a split place as its two', async () => {
    const { service, reader } = build({
      stations: storedStations(),
      frontPage: avisos(interrupted),
      articles: {},
    });

    await service.getLinesUpdate();

    const [, , routes] = reader.read.mock.calls[0];
    const ids = routes[0].stations.map((station) => station.id);
    // A notice names a place, and a place is one id now however many
    // platforms it has — so the reader is offered it once.
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids).toContain('1900');
    // Except where the two directions are two places, which the reader has to
    // be able to tell apart because a notice can name one and not the other.
    expect(ids).toEqual(expect.arrayContaining(['2402', '2401']));
  });
});

describe('a stop and what is altered on it', () => {
  const boardUrl = (id: string) =>
    `https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/transporte-urbano/parada-tranvia/${id}`;

  // The city's board for every platform code on the corridor, under the id the
  // city answers for — its own, without the padding the operator writes. So
  // asking about a stop is about the alterations on it rather than the
  // arrivals, and a stop that asks for a board that does not exist is a stop
  // that gets nothing, which is the thing worth catching.
  const boards = Object.fromEntries(
    corridor.flatMap(([out, name, back]) =>
      [out, back].map((code) => [
        boardUrl(stopCode(code)),
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

  it('leaves a notice that names no stop to the line', async () => {
    const { service } = onTheLine([alert({ id: 'corte' })]);

    // Line-wide, and it names no stop: it is the line's news, not this
    // platform's, and it is still in the line's own alerts.
    expect(stop(await service.getStation('1900')).alerts).toEqual([]);
    expect(await service.getAlerts()).toMatchObject([
      { id: 'corte', lines: ['L1'] },
    ]);
  });

  it('shows a stop the notices that name it', async () => {
    const { service } = onTheLine([
      alert({ id: 'suprimida', stations: ['1900'], scope: 'stations' }),
    ]);

    expect(stop(await service.getStation('1900')).alerts).toEqual([
      expect.objectContaining({ id: 'suprimida' }),
    ]);
    // Named that place and no other, so the one down the line shows nothing.
    expect(stop(await service.getStation('2402')).alerts).toEqual([]);
  });

  it('calls the line what the network calls it, not what the feed does', async () => {
    const { service } = onTheLine([]);

    const answered = stop(await service.getStation('1900'));

    // The city's board says `1`; the line list says `L1`. A client matching
    // an arrival to a line has to be given the same id by both.
    expect(answered.times.map((time) => time.line)).toEqual(['L1', 'L1']);
  });

  it('shows what one board says when the other does not answer', async () => {
    // A place has two boards and they fail one at a time. At the terminus one
    // of the two is empty even when both answer, so a stop that needs both to
    // work is a stop with no times whenever either blinks.
    const { service } = build({
      stations: storedStations(),
      pages: boards,
      unreachable: [boardUrl('1901')],
    });

    const answered = stop(await service.getStation('1900'));

    expect(answered.times).toHaveLength(1);
  });

  it('fails only when no board of the stop answers', async () => {
    const { service } = build({
      stations: storedStations(),
      pages: boards,
      unreachable: [boardUrl('1901'), boardUrl('1902')],
    });

    await expect(service.getStation('1900')).rejects.toBeDefined();
  });

  it('reads both boards of a place and only its own of a one-way stop', async () => {
    const { service } = onTheLine([]);

    // Both platforms of a place the tram calls at each way.
    expect(stop(await service.getStation('1900')).times).toHaveLength(2);
    // And for a stop only one direction calls at, its own board alone. The
    // other platform of that code is a stop the city does not have, and
    // asking for it is what used to leave these without a time at all.
    expect(stop(await service.getStation('2402')).times).toHaveLength(1);
    expect(stop(await service.getStation('2401')).times).toHaveLength(1);
  });

  it('still answers with the stop when it has no alterations at all', async () => {
    const { service } = onTheLine([]);

    const answered = stop(await service.getStation('1900'));
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
