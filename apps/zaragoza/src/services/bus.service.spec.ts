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

const dropdown = (lines: [string, string][]) =>
  `<select id="linea-lineas-horarios">
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
      const existing = this.docs.find((item) => item.id === filter.id);
      if (existing) {
        applyUpdate(existing, update.$set);
        return;
      }
      this.docs.push(applyUpdate({ id: filter.id } as T, update.$set));
    });
    return { modifiedCount: operations.length };
  }
}

const build = (options: {
  lines?: [string, string][];
  kmls?: Record<string, [string, string][]>;
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
  if (options.lines) bodies.set(linesUrl, dropdown(options.lines));
  Object.entries(options.kmls ?? {}).forEach(([url, stops]) =>
    bodies.set(url, kml(stops)),
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
        { id: '21', name: 'Barrio Jesús', stations: [], hidden: true },
      ],
    });

    const resp = await service.getLinesUpdate();

    expect(resp['21'].hidden).toBe(false);
    expect(resp['21'].stations).toEqual(['1']);
  });

  it('hides a line the source stopped offering and drops it from its stops', async () => {
    const { service, stationModel } = build({
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

    expect(Object.keys(resp)).toEqual([
      '21',
      'C1',
      'Ci2',
      'EM1',
      'EM2',
      'TUR',
      'N1',
    ]);
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

describe('getLine', () => {
  it('answers 404 for a line that is not stored', async () => {
    const { service } = build({});

    await expect(service.getLine('99')).rejects.toMatchObject({
      response: { statusCode: 404 },
    });
  });
});
