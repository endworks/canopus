import {
  foldText,
  matchScore,
  queryTokens,
  rankHits,
  searchable,
  SearchHit,
} from '@canopus/shared';

describe('the shared search', () => {
  it('folds accents, case and punctuation', () => {
    expect(foldText('Plaza del PILAR, Zaragoza')).toBe(
      'plaza del pilar zaragoza',
    );
    expect(foldText('Exposición «España»')).toBe('exposicion espana');
  });

  it('drops stop words unless they are all there is', () => {
    expect(queryTokens('plaza de la navidad')).toEqual(['plaza', 'navidad']);
    expect(queryTokens('de')).toEqual(['de']);
  });

  it('matches a word being typed', () => {
    expect(
      matchScore('pil', [{ text: 'Fiestas del Pilar', weight: 3 }]),
    ).toBeGreaterThan(0);
  });

  it('does not match inside a word', () => {
    expect(matchScore('lar', [{ text: 'Fiestas del Pilar', weight: 3 }])).toBe(
      0,
    );
  });

  it('needs every word', () => {
    expect(
      matchScore('pilar belen', [{ text: 'Fiestas del Pilar', weight: 3 }]),
    ).toBe(0);
  });

  it('puts the thing named that above the things that mention it', () => {
    const stop = matchScore('plaza españa', [
      { text: 'Plaza España', weight: 3 },
    ]);
    const event = matchScore('plaza españa', [
      { text: 'Concentración de peñas', weight: 3 },
      { text: 'Plaza España', weight: 1 },
    ]);
    expect(stop).toBeGreaterThan(event);
  });

  it('ranks, and keeps ties in a stable order', () => {
    const hit = (title: string, score: number): SearchHit => ({
      type: 'venue',
      id: title,
      title,
      service: 'agenda',
      score,
    });
    expect(
      rankHits([hit('b', 1), hit('a', 1), hit('c', 5), hit('z', 0)], 10).map(
        (h) => h.id,
      ),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('what the live search got wrong on 25 November 2026', () => {
  it('reads the city abbreviations as the words they stand for', () => {
    expect(
      matchScore('plaza españa', [{ text: 'Pza. España', weight: 3 }]),
    ).toBeGreaterThan(0);
    expect(
      matchScore('pza españa', [{ text: 'Plaza de España', weight: 3 }]),
    ).toBeGreaterThan(0);
    expect(
      matchScore('avenida goya', [{ text: 'Av. de Goya nº 15', weight: 3 }]),
    ).toBeGreaterThan(0);
  });

  it('counts "Plaza de España" as the whole of "plaza españa"', () => {
    const whole = matchScore('plaza españa', [
      { text: 'Plaza de España', weight: 3 },
    ]);
    const mention = matchScore('plaza españa', [
      { text: 'Ronda en la Plaza España de Casetas', weight: 3 },
    ]);
    expect(whole).toBeGreaterThanOrEqual(30);
    expect(whole).toBeGreaterThan(mention);
  });

  it('forgives one slip in a word of four letters or more', () => {
    expect(
      matchScore('pilr', [{ text: 'Fiestas del Pilar', weight: 3 }]),
    ).toBeGreaterThan(0);
    expect(
      matchScore('navidd', [{ text: 'Navidad en el Pilar', weight: 3 }]),
    ).toBeGreaterThan(0);
    expect(matchScore('pil', [{ text: 'Fiestas del Pilar', weight: 3 }])).toBe(
      matchScore('pil', [{ text: 'Fiestas del Pilar', weight: 3 }]),
    );
    expect(matchScore('pzl', [{ text: 'Fiestas del Pilar', weight: 3 }])).toBe(
      0,
    );
  });

  it('ranks a slip below the word spelt right', () => {
    const right = matchScore('pilar', [{ text: 'Pilar', weight: 3 }]);
    const slip = matchScore('pilra', [{ text: 'Pilar', weight: 3 }]);
    expect(slip).toBeGreaterThan(0);
    expect(slip).toBeLessThan(right);
  });

  it('wants a number whole, except in a code', () => {
    expect(
      matchScore('1', [{ text: '12 años de ilustración', weight: 3 }]),
    ).toBe(0);
    expect(
      matchScore('72', [{ text: '720', weight: 2, identifier: true }]),
    ).toBeGreaterThan(0);
  });

  it('will not search on one letter, but will on one digit', () => {
    expect(searchable('a')).toBe(false);
    expect(searchable(' . ')).toBe(false);
    expect(searchable('7')).toBe(true);
    expect(searchable('ab')).toBe(true);
  });

  it('breaks a tie by type, then by the soonest date', () => {
    const hit = (
      type: SearchHit['type'],
      id: string,
      startDate?: string,
    ): SearchHit => ({
      type,
      id,
      title: 'x',
      service: 's',
      score: 10,
      startDate,
    });
    const ranked = rankHits(
      [
        hit('bizi-station', '35'),
        hit('activity', 'june', '2027-06-12'),
        hit('bus-stop', '35'),
        hit('activity', 'december', '2026-12-13'),
        hit('bus-line', '35'),
      ],
      10,
    );
    expect(ranked.map((h) => `${h.type}:${h.id}`)).toEqual([
      'bus-line:35',
      'bus-stop:35',
      'bizi-station:35',
      'activity:december',
      'activity:june',
    ]);
  });
});
