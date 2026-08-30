import { HttpService } from '@nestjs/axios';
import { HttpException } from '@nestjs/common';
import { createCache } from 'cache-manager';
import { AnyBulkWriteOperation, Model } from 'mongoose';
import { of, throwError } from 'rxjs';
import {
  BusAlert,
  BusAlertDocument,
  BusLine,
  BusLineDocument,
  BusStation,
  BusStationDocument,
} from '../schemas/bus.schema';
import { BusService } from './bus.service';
import { AlertDetails, AlertReader } from '../alert-reader';
import { extraLineIds, KmlForLine } from '../utils';

const dropdown = (lines: [string, string][], links: string[] = []) =>
  `${links.map((url) => `<a href="${url}">kml</a>`).join('')}
   <select id="linea-lineas-horarios">
     <option value="lineDefault">Elige una línea</option>
     ${lines
       .map(
         ([value, label]) =>
           `<option value="${value}">${value} – ${label}</option>`,
       )
       .join('')}
   </select>`;

const kml = (stops: [string, string][]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <kml><Document>
     ${stops
       .map(
         ([id, street]) =>
           `<Placemark><name>Poste ${id} - ${street}</name>
              <Point><coordinates>-0.88,41.65,0.0</coordinates></Point>
            </Placemark>`,
       )
       .join('')}
   </Document></kml>`;

// The listing of alterations, as the theme renders one post per entry.
const alerts = (entries: [string, string, string][]) =>
  `<section>${entries
    .map(
      ([slug, date, lines]) =>
        `<article>
           <h3><a href="https://zaragoza.avanzagrupo.com/${slug}/">${slug}</a></h3>
           <p>${date}</p><p>Líneas: ${lines}</p>
         </article>`,
    )
    .join('')}</section>`;

const today = () => {
  const now = new Date();
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  return `${now.getUTCDate()} ${months[now.getUTCMonth()]}, ${now.getUTCFullYear()}`;
};

// What pasobus serves for one stop: the arrivals table is the second one.
const pasobusUrl = (id: string) =>
  `https://zaragoza-pasobus.avanzagrupo.com/frm_esquemaparadatime.php?poste=${id}`;

const pasobus = (rows: [string, string, string][]) =>
  `<table><tr><td>Poste 1</td></tr></table>
   <table>
     ${rows
       .map(
         ([line, destination, time]) =>
           `<tr><td class="digital">${line}</td>
                <td class="digital">${destination}</td>
                <td class="digital">${time}</td></tr>`,
       )
       .join('')}
   </table>`;

const alertsUrl =
  'https://zaragoza.avanzagrupo.com/category/alteraciones-del-servicio/';
const linesUrl = 'https://zaragoza.avanzagrupo.com/lineas-y-horarios/';
const kmlUrl = (id: string, direction: number) => KmlForLine(id)[direction - 1];

const httpError = (status: number) => {
  const error: Error & { response?: { status: number } } = new Error(
    `Request failed with status code ${status}`,
  );
  error.response = { status };
  return error;
};

// Mongoose drops keys whose value is undefined from an update, which is why
// `hidden` has to be written as a real boolean; the fake does the same.
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

  async updateMany(
    filter: { hidden?: unknown },
    update: { $unset: Record<string, unknown> },
  ) {
    const keys = Object.keys(update.$unset);
    this.docs.forEach((doc) =>
      keys.forEach((key) => {
        if (filter.hidden && !(key in doc)) return;
        delete doc[key];
      }),
    );
    return { modifiedCount: this.docs.length };
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

// The reader without a model behind it: the details are whatever the test
// says the article turned out to say.
const fakeReader = (details?: Record<string, AlertDetails>) =>
  ({
    enabled: !!details,
    read: jest.fn(async (alert) => details?.[alert.id]),
  }) as unknown as AlertReader & { read: jest.Mock };

const build = (options: {
  lines?: [string, string][];
  kmls?: Record<string, [string, string][]>;
  // Any other page the site serves, by URL.
  pages?: Record<string, string>;
  // Route files the lines page links, rather than leaving to the convention.
  links?: string[];
  // URLs the site answers with a server error: an outage, not a missing file.
  unreachable?: string[];
  storedLines?: Partial<BusLine>[];
  storedStations?: Partial<BusStation>[];
  storedAlerts?: Partial<BusAlert>[];
  // What reading each alert's article yields, by alert id. Absent means no
  // model is configured for this deployment.
  articles?: Record<string, AlertDetails>;
}) => {
  const lineModel = new FakeModel<BusLine>(
    (options.storedLines ?? []) as BusLine[],
  );
  const stationModel = new FakeModel<BusStation>(
    (options.storedStations ?? []) as BusStation[],
  );
  const alertModel = new FakeModel<BusAlert>(
    (options.storedAlerts ?? []) as BusAlert[],
  );

  const bodies = new Map<string, string>();
  if (options.lines) {
    bodies.set(linesUrl, dropdown(options.lines, options.links));
  }
  Object.entries(options.kmls ?? {}).forEach(([url, stops]) =>
    bodies.set(url, kml(stops)),
  );
  Object.entries(options.pages ?? {}).forEach(([url, html]) =>
    bodies.set(url, html),
  );

  const httpService = {
    get: jest.fn((url: string) => {
      if (bodies.has(url)) return of({ data: bodies.get(url) });
      if (options.unreachable?.includes(url)) {
        return throwError(() => httpError(500));
      }
      return throwError(() => httpError(404));
    }),
  } as unknown as HttpService;

  const reader = fakeReader(options.articles);
  const service = new BusService(
    createCache(),
    stationModel as unknown as Model<BusStationDocument>,
    lineModel as unknown as Model<BusLineDocument>,
    alertModel as unknown as Model<BusAlertDocument>,
    httpService,
    reader,
  );

  return { service, lineModel, stationModel, alertModel, httpService, reader };
};

describe('getLinesUpdate', () => {
  it('keeps going when a line publishes no KML', async () => {
    const { service } = build({
      lines: [
        ['21', 'BARRIO JESUS - OLIVER MIRALBUENO'],
        ['38', 'BAJO ARAGON - VALDEFIERRO'],
      ],
      // Line 38 answers 404 on both of its guessed route files.
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
      storedLines: [
        { id: '38', name: 'Bajo Aragón - Valdefierro', stations: ['900'] },
      ],
    });

    const resp = await service.getLinesUpdate();

    // EM1/EM2 are the extra ids the dropdown never lists.
    expect(Object.keys(resp)).toEqual(['21', '38', 'EM1', 'EM2']);
    expect(resp['21'].stations).toEqual(['1']);
    // The stops read before survive a route file that has gone missing.
    expect(resp['38'].stations).toEqual(['900']);
    expect(resp['38'].hidden).toBe(false);
  });

  it('shows a line again once its route comes back', async () => {
    const { service } = build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
      storedLines: [
        { id: '21', name: 'Barrio Jesús', stations: [], withdrawn: true },
      ],
    });

    const resp = await service.getLinesUpdate();

    expect(resp['21'].hidden).toBe(false);
    expect(resp['21'].stations).toEqual(['1']);
  });

  it('hides a line with no route without calling it withdrawn', async () => {
    const { service } = build({
      lines: [
        ['21', 'BARRIO JESUS - OLIVER MIRALBUENO'],
        ['TUR', 'TURISTICO DIURNO'],
      ],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
    });

    const resp = await service.getLinesUpdate();

    // The source still offers it; there is just nothing to draw.
    expect(resp['TUR'].hidden).toBe(true);
    expect(resp['21'].hidden).toBe(false);
  });

  it('drops the flag the two of them replaced, even where no run rewrites', async () => {
    const { service, lineModel } = build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
      storedLines: [
        { id: '21', name: 'Barrio Jesús', stations: [], hidden: true } as never,
        // Already withdrawn, so it gets no write of its own.
        {
          id: '24',
          name: 'Las Fuentes',
          withdrawn: true,
          hidden: true,
        } as never,
      ],
    });

    await service.getLinesUpdate();

    lineModel.docs.forEach((line) => expect(line).not.toHaveProperty('hidden'));
  });

  it('hides a line the source stopped offering and drops it from its stops', async () => {
    const { service, stationModel, lineModel } = build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
      storedLines: [
        { id: '24', name: 'Las Fuentes - Valdefierro', stations: ['1', '7'] },
      ],
      storedStations: [
        { id: '1', street: 'Av. de Navarra nº 71', lines: ['21', '24'] },
        { id: '7', street: 'Camino del Pilón nº 131', lines: ['24'] },
      ],
    });

    const resp = await service.getLinesUpdate();

    expect(resp['24'].hidden).toBe(true);
    expect(resp['21'].hidden).toBe(false);
    expect(lineModel.docs.find((line) => line.id === '24').withdrawn).toBe(
      true,
    );
    // Bookkeeping: it says why a line is hidden, and stays off the wire.
    expect(resp['24']).not.toHaveProperty('withdrawn');
    expect(stationModel.docs.find((s) => s.id === '1').lines).toEqual(['21']);
    // A stop no line reaches any more is still cleaned up.
    expect(stationModel.docs.find((s) => s.id === '7').lines).toEqual([]);
  });

  it('leaves a line untouched when only its own route is unreachable', async () => {
    const { service, lineModel } = build({
      lines: [
        ['21', 'BARRIO JESUS - OLIVER MIRALBUENO'],
        ['38', 'BAJO ARAGON - VALDEFIERRO'],
      ],
      kmls: {
        [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']],
        // Line 38's first file reads, the second one errors: a half-read route
        // must not be mistaken for a shortened one.
        [kmlUrl('38', 1)]: [['2', 'Camino del Pilón nº 131']],
      },
      unreachable: [kmlUrl('38', 2)],
      storedLines: [
        {
          id: '38',
          name: 'Bajo Aragón - Valdefierro',
          stations: ['900'],
          lastUpdated: 'yesterday',
        },
      ],
    });

    await service.getLinesUpdate();

    expect(lineModel.docs.find((line) => line.id === '38')).toEqual({
      id: '38',
      name: 'Bajo Aragón - Valdefierro',
      stations: ['900'],
      lastUpdated: 'yesterday',
    });
  });

  it('rewrites no stop when a run finds nothing changed', async () => {
    const { service, stationModel } = build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
    });

    await service.getLinesUpdate();
    const writes = jest.spyOn(stationModel, 'bulkWrite');
    await service.getLinesUpdate();

    expect(writes).not.toHaveBeenCalled();
  });

  it('lists numbered lines first and night lines last', async () => {
    const ids: [string, string][] = [
      ['N1', 'PLAZA ARAGON - LA JOTA'],
      ['TUR', 'TURISTICO DIURNO'],
      ['Ci2', 'CIRCULAR 2'],
      ['21', 'BARRIO JESUS - OLIVER MIRALBUENO'],
      ['C1', 'PLAZA DE LAS CANTERAS - COMPLEJO FUNERARIO'],
    ];
    const { service } = build({
      lines: ids,
      kmls: Object.fromEntries(
        ids.map(([id], index) => [
          kmlUrl(id, 1),
          [[`${index + 1}`, 'Av. de Navarra nº 71']],
        ]),
      ),
    });

    const resp = await service.getLinesUpdate();

    const expected = ['21', 'C1', 'Ci2', 'EM1', 'EM2', 'TUR', 'N1'];
    expect(Object.keys(resp)).toEqual(expected);
    // The order is the payload's only carrier of it, so it has to survive
    // being serialised over RPC and back.
    expect(Object.keys(JSON.parse(JSON.stringify(resp)))).toEqual(expected);
  });

  it('reads a route file the site links, on top of the ones it guesses', async () => {
    const linked =
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2026/01/21-1.kml';
    const { service, httpService } = build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      links: [linked],
      kmls: {
        [linked]: [['5', 'Av. de Navarra nº 71']],
        [kmlUrl('21', 1)]: [['1', 'Camino del Pilón nº 131']],
      },
    });

    const resp = await service.getLinesUpdate();

    // A page that links one direction must not cost us the other.
    expect(resp['21'].stations).toEqual(['5', '1']);
    const requested = (httpService.get as jest.Mock).mock.calls.map(
      ([url]) => url,
    );
    expect(requested).toContain(linked);
    expect(requested).toContain(kmlUrl('21', 1));
  });

  it('leaves the stored lines alone when the dropdown reads empty', async () => {
    const { service, lineModel } = build({
      lines: [],
      storedLines: [{ id: '21', name: 'Barrio Jesús', stations: ['1'] }],
    });

    await expect(service.getLinesUpdate()).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(lineModel.docs).toEqual([
      { id: '21', name: 'Barrio Jesús', stations: ['1'] },
    ]);
  });

  it('leaves the stored lines alone when the route files cannot be read', async () => {
    const { service, lineModel } = build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      unreachable: ['21', ...extraLineIds].flatMap(KmlForLine),
      storedLines: [{ id: '21', name: 'Barrio Jesús', stations: ['1'] }],
    });

    await expect(service.getLinesUpdate()).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(lineModel.docs).toEqual([
      { id: '21', name: 'Barrio Jesús', stations: ['1'] },
    ]);
  });
});

describe('getStation', () => {
  it('names a night line the way the network does', async () => {
    const { service } = build({
      pages: {
        [pasobusUrl('1')]: pasobus([
          ['N06', 'LA CARTUJA', '7 minutos'],
          ['21', 'BARRIO JESUS', '3 minutos'],
        ]),
      },
    });

    const resp = await service.getStation('1', 'web');

    // The site pads the number ("N06"); the line is N6 everywhere else.
    expect(resp).toMatchObject({
      lines: ['21', 'N6'],
      times: [
        { line: '21', destination: 'Barrio Jesús', time: '3 min.' },
        { line: 'N6', destination: 'La Cartuja', time: '7 min.' },
      ],
    });
  });
});

describe('alerts', () => {
  const listing = alerts([
    ['fiestas-en-miralbueno', today(), '21, 52, 53'],
    ['vive-latino', today(), '23, 34, ES7'],
  ]);

  const withAlerts = (extra: Record<string, unknown> = {}) =>
    build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
      pages: { [alertsUrl]: listing },
      ...extra,
    });

  it('stores what the listing publishes, on a lines update', async () => {
    const { service, alertModel } = withAlerts();

    await service.getLinesUpdate();

    expect(alertModel.docs).toEqual([
      expect.objectContaining({
        id: 'fiestas-en-miralbueno',
        title: 'fiestas-en-miralbueno',
        url: 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno/',
        lines: ['21', '52', '53'],
      }),
      expect.objectContaining({
        id: 'vive-latino',
        // An id the network does not run is kept as it was published.
        lines: ['23', '34', 'ES7'],
      }),
    ]);
    expect(await service.getAlerts()).toHaveLength(2);
  });

  it('keeps the day it first saw an alert across runs', async () => {
    const { service, alertModel } = withAlerts({
      storedAlerts: [
        {
          id: 'fiestas-en-miralbueno',
          title: 'Fiestas en Miralbueno',
          url: 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno/',
          lines: ['21'],
          firstSeen: '2026-08-24T04:00:00.000Z',
        },
      ],
    });

    await service.getLinesUpdate();

    const stored = alertModel.docs.find(
      (alert) => alert.id === 'fiestas-en-miralbueno',
    );
    expect(stored.firstSeen).toBe('2026-08-24T04:00:00.000Z');
    // The listing is what the lines are, not the union with what we had.
    expect(stored.lines).toEqual(['21', '52', '53']);
  });

  it('leaves the stored alerts alone when the listing cannot be read', async () => {
    const stored = {
      id: 'fiestas-en-miralbueno',
      title: 'Fiestas en Miralbueno',
      url: 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno/',
      date: today(),
      lines: ['21'],
      firstSeen: new Date().toISOString(),
    };
    const { service, alertModel } = build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
      // The home page is a 500: an alteration nobody can read is not an
      // alteration that ended, and it is never the lines update's problem.
      unreachable: [alertsUrl],
      storedAlerts: [stored],
    });

    const resp = await service.getLinesUpdate();

    expect(Object.keys(resp)).toContain('21');
    expect(alertModel.docs).toEqual([stored]);
  });

  it('drops an alert a week after the day it was announced', async () => {
    const old = '2019-12-01';
    const { service } = build({
      storedAlerts: [
        {
          id: 'old',
          title: 'Fiestas del Pilar 2019',
          url: 'https://zaragoza.avanzagrupo.com/old/',
          date: old,
          lines: ['21'],
          firstSeen: `${old}T04:00:00.000Z`,
        },
      ],
    });

    expect(await service.getAlerts()).toEqual([]);
  });

  it('shows a station only the alerts of the lines that serve it', async () => {
    const { service } = build({
      pages: {
        [alertsUrl]: listing,
        [pasobusUrl('1')]: pasobus([['21', 'BARRIO JESUS', '3 minutos']]),
      },
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
    });
    await service.getLinesUpdate();

    const resp = await service.getStation('1', 'web');

    // Line 21 is altered; the alert for 23/34/ES7 is somebody else's stop.
    expect(resp).toMatchObject({
      lines: ['21'],
      alerts: [
        expect.objectContaining({
          id: 'fiestas-en-miralbueno',
          url: 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno/',
        }),
      ],
    });
    // Bookkeeping stays off the wire.
    expect(JSON.stringify(resp)).not.toContain('firstSeen');
  });

  it('leaves a station with no altered line without alerts', async () => {
    const { service } = build({
      pages: {
        [alertsUrl]: listing,
        [pasobusUrl('2')]: pasobus([['44', 'ACTUR', '5 minutos']]),
      },
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: { [kmlUrl('21', 1)]: [['1', 'Av. de Navarra nº 71']] },
    });
    await service.getLinesUpdate();

    const resp = await service.getStation('2', 'web');

    expect(resp).toMatchObject({ alerts: [] });
  });
});

describe('alert articles', () => {
  const article = (text: string) => `<article><p>${text}</p></article>`;
  const articleUrl = 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno/';
  const listing = alerts([['fiestas-en-miralbueno', today(), '21']]);

  const isoDay = (offset: number) =>
    new Date(Date.now() + offset * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

  const read = {
    'fiestas-en-miralbueno': {
      startDate: isoDay(0),
      endDate: isoDay(2),
      stations: ['1', '2'],
      // The whole line is altered; the two stops are just the ones it names.
      scope: 'line' as const,
    },
  };

  const withArticle = (extra: Record<string, unknown> = {}) =>
    build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
      kmls: {
        [kmlUrl('21', 1)]: [
          ['1', 'Av. de Navarra nº 71'],
          // As the KML spells it, accents and all missing.
          ['2', 'Campus Rio Ebro'],
        ],
      },
      pages: {
        [alertsUrl]: listing,
        [articleUrl]: article('Del 24 al 26 de agosto, postes 1 y 2.'),
      },
      articles: read,
      ...extra,
    });

  it('stores the dates, stops and lines the article gives', async () => {
    const { service, alertModel } = withArticle();

    await service.getLinesUpdate();

    expect(alertModel.docs[0]).toMatchObject({
      startDate: read['fiestas-en-miralbueno'].startDate,
      endDate: read['fiestas-en-miralbueno'].endDate,
      stations: ['1', '2'],
      scope: 'line',
      lines: ['21'],
    });
    expect(alertModel.docs[0].articleHash).toEqual(expect.any(String));
  });

  it('does not read the same article twice', async () => {
    const { service, reader } = withArticle();

    await service.getLinesUpdate();
    await service.getLinesUpdate();

    // The words did not change, so they cannot say anything new.
    expect(reader.read).toHaveBeenCalledTimes(1);
  });

  it('reads it again once the article is edited', async () => {
    const { service, reader, httpService } = withArticle();
    await service.getLinesUpdate();

    // Only the article changes; every other page answers as it did.
    const asBefore = (httpService.get as jest.Mock).getMockImplementation();
    (httpService.get as jest.Mock).mockImplementation((url: string) =>
      url === articleUrl
        ? of({ data: article('Se amplía hasta el 30 de agosto.') })
        : asBefore(url),
    );
    await service.getLinesUpdate();

    expect(reader.read).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no model is configured', undefined],
    ['the reading fails', {}],
  ])(
    'leaves the alert as the listing published it when %s',
    async (_case, articles) => {
      const { service, alertModel } = withArticle({ articles });

      await service.getLinesUpdate();

      expect(alertModel.docs[0]).toMatchObject({
        lines: ['21'],
        stations: [],
        scope: 'line',
      });
      expect(alertModel.docs[0].articleHash).toBeUndefined();
    },
  );

  it('hands the model the stops of every line the alert names', async () => {
    const { service, reader } = withArticle();

    await service.getLinesUpdate();

    // In route order, with the street each stop is on: what "entre A y B" has
    // to be resolved against.
    expect(reader.read).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fiestas-en-miralbueno' }),
      expect.stringContaining('postes 1 y 2'),
      [
        {
          line: '21',
          stations: [
            { id: '1', street: 'Av. de Navarra nº 71' },
            // The prose the model matches this against carries the accent.
            { id: '2', street: 'Campus Río Ebro' },
          ],
        },
      ],
    );
  });

  it('shows a stop-level alteration only at the stops it affects', async () => {
    const { service } = withArticle({
      articles: {
        'fiestas-en-miralbueno': {
          startDate: undefined,
          endDate: undefined,
          // Stop 1 is suppressed; the rest of the line runs as usual.
          stations: ['1'],
          scope: 'stations' as const,
        },
      },
      pages: {
        [alertsUrl]: listing,
        [articleUrl]: article('Se suprime la parada de Av. de Navarra.'),
        [pasobusUrl('1')]: pasobus([['21', 'BARRIO JESUS', '3 minutos']]),
        [pasobusUrl('2')]: pasobus([['21', 'BARRIO JESUS', '6 minutos']]),
      },
    });
    await service.getLinesUpdate();

    const suppressed = await service.getStation('1', 'web');
    const untouched = await service.getStation('2', 'web');

    expect(suppressed).toMatchObject({ alerts: [{ direct: true }] });
    // Nothing happens at stop 2, so nothing is said there.
    expect(untouched).toMatchObject({ alerts: [] });
    // It is still one of the city's alterations.
    expect(await service.getAlerts()).toHaveLength(1);
  });

  it('stops narrowing a notice whose article changed under a failed reading', async () => {
    const narrowed = {
      'fiestas-en-miralbueno': {
        startDate: undefined,
        endDate: undefined,
        stations: ['1'],
        scope: 'stations' as const,
      },
    };
    const { service, alertModel, httpService, reader } = withArticle({
      articles: narrowed,
    });
    await service.getLinesUpdate();
    expect(alertModel.docs[0]).toMatchObject({ scope: 'stations' });

    // The notice is rewritten and this run cannot read what it now says.
    const asBefore = (httpService.get as jest.Mock).getMockImplementation();
    (httpService.get as jest.Mock).mockImplementation((url: string) =>
      url === articleUrl
        ? of({ data: article('Se amplía a toda la línea.') })
        : asBefore(url),
    );
    reader.read.mockResolvedValueOnce(undefined);
    await service.getLinesUpdate();

    // Nothing stands behind the narrowing any more, so it goes.
    expect(alertModel.docs[0]).toMatchObject({ scope: 'line' });
  });

  it('keeps what an earlier run read when this one cannot read at all', async () => {
    const read = {
      startDate: '2026-08-24',
      endDate: isoDay(3),
      stations: ['1'],
      scope: 'stations' as const,
      articleHash: 'the hash of the article it was read from',
    };
    // No key at all: the deployment that has never had one, and the day the
    // key stops working, are the same day for every alert already read.
    const { service, alertModel } = withArticle({
      articles: undefined,
      storedAlerts: [
        {
          id: 'fiestas-en-miralbueno',
          title: 'Fiestas en Miralbueno',
          url: articleUrl,
          date: today(),
          lines: ['21'],
          firstSeen: new Date().toISOString(),
          ...read,
        },
      ],
    });

    await service.getLinesUpdate();

    // Nothing was learned this run, so nothing was unlearned either.
    expect(alertModel.docs[0]).toMatchObject(read);
  });

  it('keeps a reading that still matches the article it was taken from', async () => {
    const { service, alertModel } = withArticle({
      articles: {
        'fiestas-en-miralbueno': {
          startDate: undefined,
          endDate: undefined,
          stations: ['1'],
          scope: 'stations' as const,
        },
      },
    });

    await service.getLinesUpdate();
    await service.getLinesUpdate();

    // Unchanged words, so the second run reads nothing and changes nothing.
    expect(alertModel.docs[0]).toMatchObject({
      scope: 'stations',
      stations: ['1'],
    });
  });

  it('shows an alert until the day its article says it ends', async () => {
    const stored = (id: string, endDate: string) => ({
      id,
      title: id,
      url: `https://zaragoza.avanzagrupo.com/${id}/`,
      // Announced long enough ago to have aged out on its own.
      date: '2019-12-01',
      lines: ['21'],
      stations: [],
      endDate,
      firstSeen: '2019-12-01T04:00:00.000Z',
    });
    const { service } = build({
      storedAlerts: [stored('running', isoDay(3)), stored('over', isoDay(-1))],
    });

    // An end date outranks the announcement window in both directions.
    expect((await service.getAlerts()).map((alert) => alert.id)).toEqual([
      'running',
    ]);
  });

  it('marks the stops the article names, without hiding the rest', async () => {
    const { service } = withArticle({
      pages: {
        [alertsUrl]: listing,
        [articleUrl]: article('Del 24 al 26 de agosto, postes 1 y 2.'),
        [pasobusUrl('1')]: pasobus([['21', 'BARRIO JESUS', '3 minutos']]),
        [pasobusUrl('9')]: pasobus([['21', 'BARRIO JESUS', '6 minutos']]),
      },
    });
    await service.getLinesUpdate();

    const named = await service.getStation('1', 'web');
    const alongTheLine = await service.getStation('9', 'web');

    // Stop 1 is in the notice; stop 9 only has the line in common with it,
    // and still gets told.
    expect(named).toMatchObject({ alerts: [{ direct: true }] });
    expect(alongTheLine).toMatchObject({ alerts: [{ direct: false }] });
  });

  it('shows a named stop the alert even when none of its lines are listed', async () => {
    const { service } = build({
      storedAlerts: [
        {
          id: 'obras',
          title: 'Obras en Gran Vía',
          url: 'https://zaragoza.avanzagrupo.com/obras/',
          date: today(),
          // A line that does not serve stop 3, and the stop itself.
          lines: ['44'],
          stations: ['3'],
          firstSeen: new Date().toISOString(),
        },
      ],
      pages: {
        [pasobusUrl('3')]: pasobus([['21', 'BARRIO JESUS', '3 minutos']]),
      },
    });

    const resp = await service.getStation('3', 'web');

    expect(resp).toMatchObject({ alerts: [{ id: 'obras', direct: true }] });
  });
});

describe('getLine', () => {
  it('answers 404 for a line that is not stored', async () => {
    const { service } = build({});

    await expect(service.getLine('99')).rejects.toMatchObject({
      response: { statusCode: 404 },
    });
  });
});
