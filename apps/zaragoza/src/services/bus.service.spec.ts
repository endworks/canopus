import { HttpService } from '@nestjs/axios';
import { HttpException } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';
import { of, throwError } from 'rxjs';
import { BusLinesResponse } from '../models/bus.interface';
import {
  BusLine,
  BusLineDocument,
  BusStation,
  BusStationDocument,
} from '../schemas/bus.schema';
import { BusService } from './bus.service';

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
const kmlUrl = (id: string, direction: number) =>
  `https://zaragoza.avanzagrupo.com/wp-content/uploads/2019/12/${id}-${direction}.kml`;

const notFound = () => {
  const error: Error & { response?: { status: number } } = new Error(
    'Request failed with status code 404',
  );
  error.response = { status: 404 };
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

  findOneAndUpdate(
    filter: { id: string },
    update: { $set: Record<string, unknown> },
  ) {
    return {
      lean: async () => {
        const existing = this.docs.find((item) => item.id === filter.id);
        if (existing) return { ...applyUpdate(existing, update.$set) };
        const created = applyUpdate({ id: filter.id } as T, update.$set);
        this.docs.push(created);
        return { ...created };
      },
    };
  }
}

const fakeCache = (): Cache => {
  const store = new Map<string, unknown>();
  return {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => {
      store.set(key, value);
      return value;
    },
    del: async (key: string) => store.delete(key),
  } as unknown as Cache;
};

const build = (options: {
  lines?: [string, string][];
  kmls?: Record<string, [string, string][]>;
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
    get: jest.fn((url: string) =>
      bodies.has(url)
        ? of({ data: bodies.get(url) })
        : throwError(() => notFound()),
    ),
  } as unknown as HttpService;

  const service = new BusService(
    fakeCache(),
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

    const resp = (await service.getLinesUpdate()) as BusLinesResponse;

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

    const resp = (await service.getLinesUpdate()) as BusLinesResponse;

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

    const resp = (await service.getLinesUpdate()) as BusLinesResponse;

    expect(resp['24'].hidden).toBe(true);
    expect(resp['21'].hidden).toBe(false);
    expect(stationModel.docs.find((s) => s.id === '1').lines).toEqual(['21']);
    // A stop no line reaches any more is still cleaned up.
    expect(stationModel.docs.find((s) => s.id === '7').lines).toEqual([]);
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

    const resp = (await service.getLinesUpdate()) as BusLinesResponse;

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

  it('leaves the stored lines alone when no route file can be read', async () => {
    const { service, lineModel } = build({
      lines: [['21', 'BARRIO JESUS - OLIVER MIRALBUENO']],
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
