import {
  foldText,
  matchScore,
  queryTokens,
  rankHits,
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
