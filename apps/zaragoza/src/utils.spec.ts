import {
  canonicalLineNames,
  capitalize,
  capitalizeEachWord,
  compareLineIds,
  extraLineIds,
  fixMojibake,
  fixWords,
  isRomanNumeral,
  normalizeLineId,
  pickCanonicalStreet,
  restoreAccents,
} from './utils';

const destination = (text: string) => capitalizeEachWord(fixWords(text));
const arrivalTime = (text: string) => capitalize(fixWords(text));

describe('fixMojibake', () => {
  it.each([
    ['SAN JOSÃ‰', 'SAN JOSÉ'],
    ['PLAZA ARAGÃ“N', 'PLAZA ARAGÓN'],
    ['AVDA. CATALUÃ‘A', 'AVDA. CATALUÑA'],
    ['P. Duque de Alba (VelÃ³dromo)', 'P. Duque de Alba (Velódromo)'],
  ])('repairs %s', (input, expected) => {
    expect(fixMojibake(input)).toBe(expected);
  });

  it('leaves already correct text alone', () => {
    expect(fixMojibake('Av. de Cataluña nº 51')).toBe('Av. de Cataluña nº 51');
  });
});

describe('fixWords', () => {
  it.each([
    // zaragoza.es deletes accented characters outright
    ['ESTACIN DELICIAS', 'Estación Delicias'],
    ['BARRIO JESS', 'Barrio Jesús'],
    ['PLAZA ARAGN', 'Plaza Aragón'],
    // avanzagrupo.com simply omits the accent
    [
      'P. Echegaray Y Caballero / S. Minguijon.',
      'P. Echegaray y Caballero / S. Minguijón.',
    ],
    ['SAN JOSE', 'San José'],
    ['TRANVIA', 'Tranvía'],
    // mojibake reaches the same result
    ['SAN JOSÃ‰', 'San José'],
  ])('restores %s', (input, expected) => {
    expect(destination(input)).toBe(expected);
  });

  it('does not rewrite Quinto outside the plaza name', () => {
    expect(destination('QUINTO DE EBRO')).toBe('Quinto de Ebro');
    expect(destination('PLAZA EMPERADOR CARLOS QUINTO')).toBe(
      'Plaza Emperador Carlos V',
    );
  });

  it('is idempotent', () => {
    ['SAN JOSÃ‰', 'ESTACIN DELICIAS', 'Sin estimacin.'].forEach((input) => {
      const once = fixWords(input);
      expect(fixWords(once)).toBe(once);
    });
  });

  it('restores the accent the arrival sort depends on', () => {
    expect(arrivalTime('Sin estimacin.')).toBe('Sin estimación.');
  });
});

describe('capitalizeEachWord', () => {
  it('keeps articles capitalised when they start a segment', () => {
    expect(destination('PZA. ARAGÓN - LA ALMOZARA - P. GOYA')).toBe(
      'Pza. Aragón - La Almozara - P. Goya',
    );
  });

  it('still lowercases articles mid-segment', () => {
    expect(destination('CAMINO DE LAS TORRES')).toBe('Camino de las Torres');
  });
});

describe('isRomanNumeral', () => {
  it('accepts real numerals', () => {
    ['XXI', 'V', 'I', 'IV'].forEach((word) =>
      expect(isRomanNumeral(word)).toBe(true),
    );
  });

  it('rejects words that only look like numerals', () => {
    ['CID', 'MIL', 'CIVIL', 'DIM'].forEach((word) =>
      expect(isRomanNumeral(word)).toBe(false),
    );
  });
});

describe('normalizeLineId', () => {
  it.each([
    ['CI3', 'Ci3'],
    ['EM1', 'EM1'],
    ['TUR', 'TUR'],
    ['N1', 'N1'],
    ['21', '21'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeLineId(input)).toBe(expected);
  });
});

describe('restoreAccents', () => {
  it.each([
    ['Campus Rio Ebro', 'Campus Río Ebro'],
    ['Tomas de Anzano (Colegio)', 'Tomás de Anzano (Colegio)'],
    ['Diputados (Aljaferia)', 'Diputados (Aljafería)'],
    [
      'Autonomía de Aragón (Campo de futbol)',
      'Autonomía de Aragón (Campo de fútbol)',
    ],
    [
      'Av. de Montañana (Rotonda I.E.S Itaca)',
      'Av. de Montañana (Rotonda I.E.S Ítaca)',
    ],
    [
      'P. Reyes de Aragon n.º 18 / Ies V. del Pilar',
      'P. Reyes de Aragón n.º 18 / Ies V. del Pilar',
    ],
  ])('fixes %s', (input, expected) => {
    expect(restoreAccents(input)).toBe(expected);
  });

  it('preserves the casing of abbreviations', () => {
    expect(restoreAccents('P. Mª Agustín nº 12 / C.M.E. Ramón y Cajal')).toBe(
      'P. Mª Agustín nº 12 / C.M.E. Ramón y Cajal',
    );
  });

  it('matches the case of the word it replaces', () => {
    expect(restoreAccents('AV. DE ARAGON')).toBe('AV. DE ARAGÓN');
    expect(restoreAccents('campus rio ebro')).toBe('campus río ebro');
  });

  it('is idempotent', () => {
    const once = restoreAccents('Campus Rio Ebro / Aljaferia');
    expect(restoreAccents(once)).toBe(once);
  });
});

describe('pickCanonicalStreet', () => {
  it('prefers the accented variant', () => {
    expect(pickCanonicalStreet(['Campus Rio Ebro', 'Campus Río Ebro'])).toBe(
      'Campus Río Ebro',
    );
  });

  it('prefers mixed case over shouting', () => {
    expect(
      pickCanonicalStreet([
        'CAMINO DEL PILÓN nº131',
        'Camino del Pilón nº 131',
      ]),
    ).toBe('Camino del Pilón nº 131');
  });

  it('repairs mojibake before comparing', () => {
    expect(pickCanonicalStreet(['P. Duque de Alba (VelÃ³dromo)'])).toBe(
      'P. Duque de Alba (Velódromo)',
    );
  });

  it('does not depend on the order the KMLs arrive in', () => {
    const variants = [
      'Av. de Navarra nº 71',
      'AV. DE NAVARRA nº71',
      'Av. de Navarra n.º 71',
    ];
    expect(pickCanonicalStreet([...variants].reverse())).toBe(
      pickCanonicalStreet(variants),
    );
  });
});

describe('canonicalLineNames', () => {
  it('names the lines the updater adds on its own', () => {
    // These are not in the dropdown, so a name has to come from here.
    extraLineIds.forEach((id) =>
      expect([id, canonicalLineNames[id]]).toEqual([id, expect.any(String)]),
    );
  });

  it('has no name left unaccented', () => {
    const unaccented =
      /\b(jesus|aljaferia|estacion|jose|tranvia|turistico|aragon|espana|penaflor|pabellon|principe)\b/i;
    Object.entries(canonicalLineNames).forEach(([id, name]) =>
      expect([id, unaccented.test(name)]).toEqual([id, false]),
    );
  });
});

describe('compareLineIds', () => {
  it('numbers the numbered lines, then letters, then the night lines', () => {
    const shuffled = ['N4', 'TUR', '51', 'Ci2', '9', 'C1', 'N10', '38', 'EM1'];
    expect([...shuffled].sort(compareLineIds)).toEqual([
      '9',
      '38',
      '51',
      'C1',
      'Ci2',
      'EM1',
      'TUR',
      'N4',
      'N10',
    ]);
  });

  it('orders every real line id the way the listing shows them', () => {
    const ids = Object.keys(canonicalLineNames);
    const sorted = [...ids].sort(compareLineIds);

    expect(sorted.slice(0, 3)).toEqual(['21', '22', '23']);
    expect(sorted.filter((id) => /^\d+$/.test(id))).toEqual(
      ids.filter((id) => /^\d+$/.test(id)),
    );
    expect(sorted.slice(-7)).toEqual([
      'N1',
      'N2',
      'N3',
      'N4',
      'N5',
      'N6',
      'N7',
    ]);
    expect(sorted.slice(-16, -7)).toEqual([
      'C1',
      'C4',
      'Ci1',
      'Ci2',
      'Ci3',
      'Ci4',
      'EM1',
      'EM2',
      'TUR',
    ]);
  });

  it('does not depend on the order it is given', () => {
    const ids = Object.keys(canonicalLineNames);
    expect([...ids].reverse().sort(compareLineIds)).toEqual(
      [...ids].sort(compareLineIds),
    );
  });
});
