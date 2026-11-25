import { describe, expect, it } from 'vitest';
import { Importer } from './importer';

const HOUR = 60 * 60 * 1000;
const importer = new Importer(
  null as any,
  null as any,
  null as any,
  null as any,
  null as any,
  null as any,
);
const ok = { errors: [] };
const refused = {
  errors: [
    { step: 'city.agenda', message: 'Request failed with status code 404' },
  ],
};

describe('Importer.interval', () => {
  it('waits six hours after a run the city answered', () => {
    expect(importer.interval([ok, refused, refused])).toBe(6 * HOUR);
  });

  it('waits twelve after one refusal and a day after two in a row', () => {
    expect(importer.interval([refused, ok])).toBe(12 * HOUR);
    expect(importer.interval([refused, refused, ok])).toBe(24 * HOUR);
  });

  it('never waits longer than a day', () => {
    expect(importer.interval([refused, refused, refused])).toBe(24 * HOUR);
  });

  it('does not back off for a failure of its own', () => {
    const ours = { errors: [{ step: 'derive', message: 'boom' }] };
    expect(importer.interval([ours, ours])).toBe(6 * HOUR);
  });
});
