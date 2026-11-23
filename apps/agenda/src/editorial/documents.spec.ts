import { expandOccurrences, validate } from './documents';

describe('validate', () => {
  it('accepts an activity of the Pilar programme', () => {
    expect(
      validate('events', {
        key: 'pilar-2026/houdini',
        type: 'activity',
        parent: 'fiestas-del-pilar-2026',
        title: { es: 'Houdini. Un musical mágico' },
        kinds: ['stage.musical', 'family'],
        places: ['teatro-principal'],
        sessions: ['2026-10-13 20:00', { date: '2026-10-17', time: '17:00' }],
        offers: [{ id: 'general', price: 22, url: 'https://example.org' }],
      }),
    ).toEqual([]);
  });

  it('says what is wrong, in words', () => {
    const errors = validate('events', {
      key: 'Bad Key',
      type: 'activity',
      parent: 'x',
      title: 'Houdini',
      kinds: ['magic.show'],
      sessions: ['13/10/2026 20:00'],
      offers: [{ id: 'general' }],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('`key`'),
        expect.stringContaining('`title`'),
        expect.stringContaining('unknown code "magic.show"'),
        expect.stringContaining('needs `places`'),
        expect.stringContaining('"13/10/2026 20:00"'),
        expect.stringContaining('says nothing'),
      ]),
    );
  });

  it('refuses a place outside the city', () => {
    expect(
      validate('places', {
        key: 'muel',
        name: { es: 'Muel' },
        kinds: ['area.square'],
        geo: [-1.0844, 41.4655],
      }),
    ).toEqual([expect.stringContaining('inside Zaragoza')]);
  });

  it('an override needs a target and something to set', () => {
    expect(
      validate('overrides', { key: 'fix', target: {}, set: {} }),
    ).toHaveLength(2);
    expect(
      validate('overrides', {
        key: 'fix',
        target: { source: 'city.agenda', ref: '316583' },
        set: { kinds: ['music.concert'] },
      }),
    ).toEqual([]);
  });
});

describe('expandOccurrences', () => {
  const placeOf = (ref?: unknown) =>
    typeof ref === 'string' ? `plc_${ref}` : undefined;

  it('an exact session, in local time', () => {
    const [o] = expandOccurrences({ sessions: ['2026-10-13 20:00'] }, placeOf);
    expect(o).toMatchObject({
      kind: 'session',
      precision: 'exact',
      localDate: '2026-10-13',
      localTime: '20:00',
    });
    expect(o.starts.toISOString()).toBe('2026-10-13T18:00:00.000Z');
  });

  it('a session after midnight is listed under the night before', () => {
    const [o] = expandOccurrences(
      { sessions: ['2026-10-12 04:15'] },
      placeOf,
      '06:00',
    );
    expect(o.localDate).toBe('2026-10-11');
    expect(o.starts.toISOString()).toBe('2026-10-12T02:15:00.000Z');
  });

  it('a day without a time is a day', () => {
    const [o] = expandOccurrences(
      { sessions: [{ date: '2026-10-16', precision: 'tbc' }] },
      placeOf,
    );
    expect(o).toMatchObject({ precision: 'tbc', localDate: '2026-10-16' });
    expect(o.localTime).toBeUndefined();
  });

  it('a fairground run, and a window every half hour', () => {
    const occurrences = expandOccurrences(
      {
        runs: [{ from: '2026-10-09', to: '2026-10-25', place: 'recinto' }],
        windows: [
          { date: '2026-10-14', from: '17:00', to: '22:30', every: 30 },
        ],
      },
      placeOf,
    );
    expect(occurrences[0]).toMatchObject({
      kind: 'run',
      localDate: '2026-10-09',
      localEndDate: '2026-10-25',
      placeId: 'plc_recinto',
    });
    expect(occurrences[1]).toMatchObject({
      kind: 'window',
      every: 30,
      localTime: '17:00',
      localEndTime: '22:30',
    });
  });

  it('a session that ends past midnight ends the next day', () => {
    const [o] = expandOccurrences(
      { sessions: [{ date: '2026-12-31', time: '23:00', end: '02:00' }] },
      placeOf,
    );
    expect(o.localEndDate).toBe('2027-01-01');
  });

  it('keys stay the same while the session does, so ids survive re-publishing', () => {
    const a = expandOccurrences({ sessions: ['2026-10-13 20:00'] }, placeOf);
    const b = expandOccurrences({ sessions: ['2026-10-13 20:00'] }, placeOf);
    expect(a[0].sourceKey).toBe(b[0].sourceKey);
  });
});
