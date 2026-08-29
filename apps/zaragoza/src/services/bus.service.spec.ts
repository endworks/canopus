import { HttpService } from '@nestjs/axios';
import { HttpException } from '@nestjs/common';
import { createCache } from 'cache-manager';
import { AnyBulkWriteOperation, Model } from 'mongoose';
import { of, throwError } from 'rxjs';
import {
  BusLine,
  BusLineDocument,
  BusStation,
  BusStationDocument,
} from '../schemas/bus.schema';
import { BusService } from './bus.service';
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
}) => {
  const lineModel = new FakeModel<BusLine>(
    (options.storedLines ?? []) as BusLine[],
  );
  const stationModel = new FakeModel<BusStation>(
    (options.storedStations ?? []) as BusStation[],
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

  const service = new BusService(
    createCache(),
    stationModel as unknown as Model<BusStationDocument>,
    lineModel as unknown as Model<BusLineDocument>,
    httpService,
  );

  return { service, lineModel, stationModel, httpService };
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

describe('getLine', () => {
  it('answers 404 for a line that is not stored', async () => {
    const { service } = build({});

    await expect(service.getLine('99')).rejects.toMatchObject({
      response: { statusCode: 404 },
    });
  });
});
