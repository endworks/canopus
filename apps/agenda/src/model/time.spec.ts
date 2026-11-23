import {
  addDays,
  fromLocal,
  localDate,
  localTime,
  toLocalIso,
  weekday,
} from './time';

describe('local time in Zaragoza', () => {
  it('winter is +01:00', () => {
    expect(fromLocal('2026-12-05', '19:00').toISOString()).toBe(
      '2026-12-05T18:00:00.000Z',
    );
  });

  it('summer is +02:00', () => {
    expect(fromLocal('2026-10-12', '08:00').toISOString()).toBe(
      '2026-10-12T06:00:00.000Z',
    );
  });

  it('the evening after the clocks go forward', () => {
    expect(fromLocal('2027-03-28', '20:00').toISOString()).toBe(
      '2027-03-28T18:00:00.000Z',
    );
  });

  it('past midnight, OpenStreetMap style, is the next day', () => {
    expect(fromLocal('2026-10-16', '29:00').toISOString()).toBe(
      '2026-10-17T03:00:00.000Z',
    );
  });

  it('reads an instant back as the local date and time', () => {
    const instant = new Date('2026-12-31T23:30:00Z');
    expect(localDate(instant)).toBe('2027-01-01');
    expect(localTime(instant)).toBe('00:30');
    expect(toLocalIso(instant)).toBe('2027-01-01T00:30:00+01:00');
  });

  it('counts days and weekdays', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekday('2026-10-12')).toBe(1);
    expect(weekday('2026-10-18')).toBe(7);
  });
});
