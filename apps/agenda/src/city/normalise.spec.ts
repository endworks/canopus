import fixtures from './fixtures/city-events.json';
import { CityEvent } from './city-record';
import { htmlToText, normaliseEvent, tidyTitle } from './normalise';

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
