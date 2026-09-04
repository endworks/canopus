import { WeatherAlert } from '../models/weather.interface';
import { collapse, filterAlerts, inForce } from './alert-filter';

const HOUR = 3600;
const NOON = 1_756_900_800;

const AEMET = 'AEMET. Agencia Estatal de Meteorología';

/** One AEMET-shaped warning: an office, a phenomenon, a band and a window. */
const warning = (
  id: string,
  overrides: Partial<WeatherAlert> = {},
): WeatherAlert => ({
  id,
  event: 'Aviso naranja por temperaturas máximas',
  headline: 'Aviso naranja por temperaturas máximas',
  description: 'Temperatura máxima: 40 °C.',
  severity: 'Severe',
  level: 'orange',
  awareness: 'high-temperature',
  urgency: 'Expected',
  certainty: 'Likely',
  onset: NOON,
  expires: NOON + 8 * HOUR,
  areas: ['Ribera del Ebro'],
  regions: [{ code: 'ES613', type: 'EMMA_ID' }],
  sender: AEMET,
  ...overrides,
});

describe('collapse', () => {
  it('folds one office’s warning about neighbouring zones into one', () => {
    // The cell is placed by its corners as well as its middle, so a point near
    // a boundary lands in two or three of AEMET's zones — and in a heatwave
    // every one of them is under the same orange warning that afternoon. The
    // reader is standing in one place, so they are owed one card.
    const folded = collapse([
      warning('zone-a'),
      warning('zone-b', {
        description: 'Temperatura máxima: 39 °C.',
        areas: ['Ibérica zaragozana'],
        regions: [{ code: 'ES614', type: 'EMMA_ID' }],
      }),
      warning('zone-c', {
        description: 'Temperatura máxima: 39 °C.',
        areas: ['Ribera del Ebro'],
        regions: [{ code: 'ES615', type: 'EMMA_ID' }],
      }),
    ]);

    expect(folded).toHaveLength(1);
    // The ground the copies covered survives the fold: a client narrowing by
    // `area` or drawing the map still sees all of it, deduplicated.
    expect(folded[0].areas).toEqual(['Ribera del Ebro', 'Ibérica zaragozana']);
    expect(folded[0].regions.map((region) => region.code)).toEqual([
      'ES613',
      'ES614',
      'ES615',
    ]);
  });

  it('keeps the office’s latest word when a re-issue names no predecessor', () => {
    // An office that updates a warning is supposed to name the message it
    // replaces, and where it does the provider drops the replaced one. AEMET's
    // re-issues often do not, and the day's revisions all arrive looking new.
    const folded = collapse([
      warning('first', {
        issued: NOON - 6 * HOUR,
        description: 'Máxima: 38 °C.',
      }),
      warning('second', { issued: NOON - HOUR, description: 'Máxima: 40 °C.' }),
    ]);

    expect(folded).toHaveLength(1);
    expect(folded[0].id).toBe('second');
    expect(folded[0].description).toBe('Máxima: 40 °C.');
  });

  it('folds the days of one spell into the spell', () => {
    // The screenshot's own case: AEMET issues a heatwave a day at a time, the
    // client draws a time and not a date, and three orange warnings for the
    // same zone read as three cards saying "until 20:59". One card, running to
    // the end of the last day, is what the reader is actually being told.
    const folded = collapse([
      warning('today', { issued: NOON - HOUR }),
      warning('tomorrow', {
        issued: NOON - HOUR,
        onset: NOON + 24 * HOUR,
        expires: NOON + 32 * HOUR,
        description: 'Temperatura máxima: 39 °C.',
      }),
      warning('thursday', {
        issued: NOON - HOUR,
        onset: NOON + 48 * HOUR,
        expires: NOON + 56 * HOUR,
        description: 'Temperatura máxima: 39 °C.',
      }),
    ]);

    expect(folded).toHaveLength(1);
    expect(folded[0].onset).toBe(NOON);
    expect(folded[0].expires).toBe(NOON + 56 * HOUR);
    // Issued together, so the day that is nearest speaks: a reader wants this
    // afternoon's forty degrees, not Thursday's thirty-nine.
    expect(folded[0].id).toBe('today');
    expect(folded[0].description).toBe('Temperatura máxima: 40 °C.');
  });

  it('starts a second card when the phenomenon has been gone a day', () => {
    // Two spells, not one long one. A gap longer than a day is a warning that
    // went away and came back, and a reader is owed the second card.
    const folded = collapse([
      warning('this week'),
      warning('next week', {
        onset: NOON + 7 * 24 * HOUR,
        expires: NOON + 7 * 24 * HOUR + 8 * HOUR,
      }),
    ]);

    expect(folded.map((alert) => alert.id)).toEqual(['this week', 'next week']);
  });

  it('leaves an episode open when any of its days has no end', () => {
    // An office that set no end has not said when this stops, and a run
    // carrying one of those cannot claim to know either.
    const folded = collapse([
      warning('today'),
      warning('open', { onset: NOON + 24 * HOUR, expires: undefined }),
    ]);

    expect(folded).toHaveLength(1);
    expect(folded[0].expires).toBeUndefined();
    expect('expires' in folded[0]).toBe(false);
  });

  it('keeps a different phenomenon, band or office apart', () => {
    const folded = collapse([
      warning('heat'),
      warning('rain', { event: 'Aviso naranja por lluvias' }),
      warning('worse', { level: 'red', severity: 'Extreme' }),
      warning('elsewhere', { sender: 'Météo-France' }),
    ]);

    // Ordered worst first, as every list of warnings here is.
    expect(folded.map((alert) => alert.id)).toEqual([
      'worse',
      'heat',
      'rain',
      'elsewhere',
    ]);
  });

  it('folds Apple’s copies, which carry no band and no wording of their own', () => {
    // Apple hands back the same offices' warnings scoped to the coordinate,
    // with the headline for a description and no colour at all, so two zones'
    // copies of one afternoon are identical character for character.
    const apple = (id: string, areaId: string): WeatherAlert =>
      warning(id, {
        level: undefined,
        awareness: undefined,
        description: 'Aviso naranja por altas temperaturas',
        areas: [],
        regions: [{ code: areaId, type: 'APPLE_AREA_ID' }],
      });

    const folded = collapse([apple('a', 'es-1'), apple('b', 'es-2')]);

    expect(folded).toHaveLength(1);
    expect(folded[0].regions.map((region) => region.code)).toEqual([
      'es-1',
      'es-2',
    ]);
  });

  it('counts one message once, however many times it arrives', () => {
    expect(collapse([warning('same'), warning('same')])).toHaveLength(1);
  });

  it('leaves a list with nothing repeated in it alone', () => {
    const alerts = [warning('heat'), warning('rain', { event: 'Lluvias' })];
    expect(collapse(alerts)).toEqual(alerts);
    // Untouched rather than rebuilt: a lone warning keeps its own identity.
    expect(collapse(alerts)[0]).toBe(alerts[0]);
  });
});

describe('filterAlerts', () => {
  it('narrows and nothing else, leaving the fold to the caller', () => {
    // The two are kept apart on purpose: only the caller knows whether what
    // survives is about one place. A list that could not be narrowed to a cell
    // is a whole country's warnings, and folding those would answer for one
    // zone with a neighbouring zone's degrees.
    const shown = filterAlerts(
      [
        warning('orange-here'),
        warning('orange-next-door', {
          areas: ['Ibérica zaragozana'],
          regions: [
            { code: 'ES613', type: 'EMMA_ID' },
            { code: 'ES614', type: 'EMMA_ID' },
          ],
        }),
        warning('green-here', { level: 'green', severity: 'Minor' }),
        warning('orange-there', {
          areas: ['Pirineo oscense'],
          regions: [{ code: 'ES620', type: 'EMMA_ID' }],
        }),
      ],
      { safety: 'orange', regions: ['ES613'] },
    );

    expect(shown.map((alert) => alert.id)).toEqual([
      'orange-here',
      'orange-next-door',
    ]);
    // And what the caller does with them, once it knows they are about a
    // place, is the fold.
    expect(collapse(shown)).toHaveLength(1);
  });
});

describe('inForce', () => {
  it('leaves the copies for the fold to deal with', () => {
    // Two things in one list, kept separate on purpose: what is still standing
    // is a question about the clock, and what is a second copy is a question
    // about the reader. MeteoAlarm caches this list for a whole country, where
    // each office's warning for each of its own zones is a real answer.
    const standing = inForce(
      [
        warning('zone-a'),
        warning('zone-b'),
        warning('lapsed', {
          expires: NOON - HOUR,
        }),
      ],
      NOON,
    );

    expect(standing.map((alert) => alert.id)).toEqual(['zone-a', 'zone-b']);
  });
});
