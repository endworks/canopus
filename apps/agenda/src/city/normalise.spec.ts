import fixtures from './fixtures/city-events.json';
import { CityEvent } from './city-record';
import {
  htmlToText,
  monumentPlace,
  nightlifePlaces,
  normaliseEvent,
  tidyTitle,
} from './normalise';
import { mergeKinds } from '../pipeline/publisher';

/**
 * Real records, as the city published them in November 2026, with their
 * geometry taken out (they were fetched in the city's own projection) and put
 * back per test in WGS84 where a test is about place.
 */
const TODAY = '2026-11-23';
const PLAZA_DEL_PILAR: [number, number] = [-0.8784, 41.6566];
const MUEL: [number, number] = [-1.0844, 41.4655];

const at = (record: CityEvent, point: [number, number]): CityEvent => ({
  ...record,
  subEvent: record.subEvent.map((sub) => ({
    ...sub,
    location: {
      ...sub.location,
      geometry: { type: 'Point', coordinates: point },
    },
  })),
});

const fixture = (key: keyof typeof fixtures) =>
  fixtures[key] as unknown as CityEvent;

describe('normaliseEvent', () => {
  it('a concert on one evening is one exact session', () => {
    const event = normaliseEvent(at(fixture('abba'), PLAZA_DEL_PILAR), TODAY);
    expect(event.visibility).toBe('listed');
    expect(event.occurrences).toHaveLength(1);
    expect(event.occurrences[0]).toMatchObject({
      kind: 'session',
      localDate: '2026-12-05',
      localTime: '19:00',
      precision: 'exact',
    });
    expect(event.occurrences[0].starts.toISOString()).toBe(
      '2026-12-05T18:00:00.000Z',
    );
  });

  it('a Christmas attraction open for six weeks is one run with its hours', () => {
    const event = normaliseEvent(at(fixture('sweet'), PLAZA_DEL_PILAR), TODAY);
    expect(event.kinds).toContain('festivity');
    expect(event.programmes).toContain('Navidad');
    expect(event.occurrences).toHaveLength(1);
    const run = event.occurrences[0];
    expect(run).toMatchObject({
      kind: 'run',
      localDate: '2026-11-27',
      localEndDate: '2027-01-06',
    });
    expect(run.hours).toEqual(
      expect.arrayContaining([
        { days: [1, 2, 3, 4], opens: '16:30', closes: '21:00' },
        { days: [5, 6, 7], opens: '16:30', closes: '22:00' },
      ]),
    );
  });

  it('an exhibition is a run, listed', () => {
    const event = normaliseEvent(at(fixture('paco'), PLAZA_DEL_PILAR), TODAY);
    expect(event.kinds[0]).toBe('exhibition');
    expect(event.visibility).toBe('listed');
    expect(event.occurrences).toHaveLength(1);
    expect(event.occurrences[0].kind).toBe('run');
  });

  it('a course is kept, for search only', () => {
    const event = normaliseEvent(at(fixture('course'), PLAZA_DEL_PILAR), TODAY);
    expect(event.visibility).toBe('searchable');
    expect(event.visibilityRule).toBe('course');
    expect(event.pricing).toBe('free');
  });

  it('a race in another town is hidden', () => {
    const event = normaliseEvent(at(fixture('muel'), MUEL), TODAY);
    expect(event.visibility).toBe('hidden');
    expect(event.visibilityRule).toBe('outside-city');
  });
});

describe('text', () => {
  it('HTML becomes plain paragraphs, entities and all', () => {
    expect(
      htmlToText(
        '<p>Exposici&oacute;n de <b>pintura</b>&nbsp;actual</p><ul><li>Uno</li><li>Dos</li></ul>',
      ),
    ).toBe('Exposición de pintura actual\n• Uno\n• Dos');
  });

  it('a title in capitals is put in sentence case', () => {
    expect(tidyTitle('LA PLAZA DE LA NAVIDAD')).toBe('La plaza de la navidad');
    expect(tidyTitle('Sweet Palace')).toBe('Sweet Palace');
  });
});

describe('monuments', () => {
  // The Puente de Hierro as the city published it in November 2026, trimmed.
  const bridge = {
    id: 83,
    title: 'Puente de Hierro  o Puente del Pilar',
    description:
      '<p>Denominado tambi&eacute;n "Puente de Nuestra Se&ntilde;ora del Pilar", se termin&oacute; en 1895.</p>',
    address: 'Pso. Echegaray y Caballero/ Avda Puente del Pilar',
    image: 'http://www.zaragoza.es/azar/img/monumentos/puentehierrop.jpg',
    top: false,
    geometry: { coordinates: [-0.871377, 41.65457] as [number, number] },
  };

  it('a monument is a landmark, its text plain and its picture on https', () => {
    const place = monumentPlace(bridge)!;
    expect(place.name).toBe('Puente de Hierro o Puente del Pilar');
    expect(place.kinds).toEqual(['landmark']);
    expect(place.source).toBe('city.monuments');
    expect(place.description).toBe(
      'Denominado también "Puente de Nuestra Señora del Pilar", se terminó en 1895.',
    );
    expect(place.image).toBe(
      'https://www.zaragoza.es/azar/img/monumentos/puentehierrop.jpg',
    );
    expect(place.featured).toBe(false);
    expect(place.coordinates).toEqual([-0.871377, 41.65457]);
  });

  it('a picture that is only a file name is dropped', () => {
    expect(
      monumentPlace({ ...bridge, image: 'fundacionlabordeta.jpg' })!.image,
    ).toBeUndefined();
  });

  it('a museum the city also lists as a monument is both', () => {
    expect(mergeKinds(['venue.museum'], ['landmark'])).toEqual([
      'venue.museum',
      'landmark',
    ]);
    expect(mergeKinds(['venue'], ['landmark'])).toEqual(['landmark']);
    expect(mergeKinds(undefined, ['venue'])).toEqual(['venue']);
  });
});

describe('nightlife', () => {
  const venue = (id: number, title: string) => ({
    id,
    title,
    calle: 'Calle',
    geometry: { coordinates: [-0.88, 41.65] as [number, number] },
  });

  it('only the reviewed discos are kept, under the name people use, each once', () => {
    const places = nightlifePlaces([
      venue(5605, 'Sala de Música. López'),
      venue(11026, 'Café Botánico'),
      venue(29754, 'Hide Club'),
      venue(5605, 'Sala de Música. López'),
      venue(99999, 'Discoteca Nueva'),
    ]);
    expect(places.map((p) => p.name)).toEqual(['Sala López', 'Hïde Club']);
    expect(places.every((p) => p.kinds[0] === 'venue.club')).toBe(true);
  });
});
