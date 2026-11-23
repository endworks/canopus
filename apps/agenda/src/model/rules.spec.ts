import { EDITIONS, SERIES } from '../seeds/series';
import { datesFor, easterSunday, nextByRule } from './rules';
import { nextExpected, usualWindow } from '../pipeline/editorial';

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
  ])('%i', (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});

describe('every seeded rule reproduces the editions research.md confirms', () => {
  const ruled = SERIES.filter((s) => s.rule);
  for (const series of ruled) {
    for (const known of series.known) {
      it(`${series.key} ${known.year}`, () => {
        const dates = datesFor(series.rule, known.year);
        if (series.precision === 'weekend') {
          // The switch-on is the Friday or the Saturday of the weekend.
          const gap =
            (Date.parse(known.startDate) - Date.parse(dates.startDate)) /
            86400000;
          expect(gap).toBeGreaterThanOrEqual(0);
          expect(gap).toBeLessThanOrEqual(1);
          expect(dates.endDate).toBe(known.endDate);
        } else {
          expect(dates).toEqual({
            startDate: known.startDate,
            endDate: known.endDate,
          });
        }
      });
    }
  }
});

describe('the next edition, as of 23 November 2026', () => {
  const today = '2026-11-23';
  const series = (key: string) => SERIES.find((s) => s.key === key);

  it('Pilar: 9–17 October 2027', () => {
    expect(nextByRule(series('fiestas-del-pilar').rule, today)).toEqual({
      startDate: '2027-10-09',
      endDate: '2027-10-17',
    });
  });

  it('Semana Santa: Palm Sunday to Easter 2027', () => {
    expect(nextByRule(series('semana-santa').rule, today)).toEqual({
      startDate: '2027-03-21',
      endDate: '2027-03-28',
    });
  });

  it('Carnaval 2027', () => {
    expect(nextByRule(series('carnaval').rule, today)).toEqual({
      startDate: '2027-02-06',
      endDate: '2027-02-09',
    });
  });

  it('Navidad, while 2026 is announced: the announced dates', () => {
    const navidad = EDITIONS.find((e) => e.key === 'navidad-2026');
    expect(
      nextExpected(
        {
          recurrence: {
            pattern: 'yearly',
            rule: series('navidad').rule,
            precision: 'weekend',
          },
        },
        navidad,
        undefined,
        today,
      ),
    ).toEqual({
      startDate: '2026-11-27',
      endDate: '2027-01-06',
      precision: 'day',
      basis: 'announced',
    });
  });

  it('Navidad, while 2026 is on: 2027, by the rule', () => {
    const navidad = EDITIONS.find((e) => e.key === 'navidad-2026');
    expect(
      nextExpected(
        {
          recurrence: {
            pattern: 'yearly',
            rule: series('navidad').rule,
            precision: 'weekend',
          },
        },
        undefined,
        navidad,
        '2026-12-10',
      ),
    ).toEqual({
      startDate: '2027-11-26',
      endDate: '2028-01-06',
      precision: 'weekend',
      basis: 'rule',
    });
  });

  it('Champions Burger has no rule: only its usual months', () => {
    expect(
      nextExpected(
        {
          recurrence: {
            pattern: 'irregular',
            usualMonths: [3, 4],
            precision: 'season',
          },
        },
        undefined,
        undefined,
        today,
      ),
    ).toEqual({
      startDate: '2027-03-01',
      endDate: '2027-04-30',
      precision: 'season',
      basis: 'usual-months',
    });
  });

  it('usual months across the new year', () => {
    expect(usualWindow([11, 12], '2026-12-01')).toEqual({
      startDate: '2027-11-01',
      endDate: '2027-12-31',
    });
  });
});
