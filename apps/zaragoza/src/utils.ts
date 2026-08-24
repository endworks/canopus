export const capitalize = (text: string, setLowercase: boolean = true) => {
  if (text) {
    if (setLowercase) {
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    } else {
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  }
  return null;
};

export const isRomanNumeral = (word: string): boolean => {
  const upper = word.toUpperCase();
  return /^(?=[IVXLCDM])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/.test(
    upper,
  );
};

const alwaysLowercaseWords = ['y', 'a', 'de', 'en', 'del', 'la', 'los', 'las'];

const segmentSeparator = /[-–/(,]$/;

export const capitalizeEachWord = (
  text: string,
  setLowercase: boolean = true,
) => {
  if (text) {
    let atSegmentStart = true;
    return text
      .split(' ')
      .map((word) => {
        const lower = word.toLowerCase();
        const startsSegment = atSegmentStart;
        atSegmentStart = segmentSeparator.test(word);

        if (alwaysLowercaseWords.includes(lower) && !startsSegment) {
          return lower;
        }

        if (isRomanNumeral(word)) {
          return word.toUpperCase();
        }

        if (word.includes('/')) {
          return word
            .split('/')
            .map((splitWord) => capitalize(splitWord.trim(), setLowercase))
            .join('/');
        }
        if (word.includes('-')) {
          return word
            .split('-')
            .map((splitWord) => capitalize(splitWord.trim(), setLowercase))
            .join('-');
        }

        return capitalize(word, setLowercase);
      })
      .join(' ');
  }
  return null;
};

// Nothing here changes faster than the scrapers can re-read it, and an entry
// that never expires is one the writer has to remember to invalidate by hand.
export const cacheTTL = 1000 * 60 * 60 * 6;

export const isInt = (number: number | string) => {
  if (typeof number == 'number') {
    return true;
  } else if (typeof number != 'string') {
    return false;
  }
  return !isNaN(parseFloat(number));
};

// Characters cp1252 uses in 0x80-0x9F, where latin-1 has controls. Needed to
// turn double-encoded text ("VelÃ³dromo") back into the bytes it came from.
const cp1252Extra: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

export const fixMojibake = (text: string): string => {
  if (!text || !/[ÃÂ]/.test(text)) return text;

  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0xff) {
      bytes.push(code);
    } else if (cp1252Extra[char] !== undefined) {
      bytes.push(cp1252Extra[char]);
    } else {
      return text;
    }
  }

  const decoded = Buffer.from(bytes).toString('utf8');
  return decoded.includes('�') ? text : decoded;
};

// pasobus prefixes a utf-8 BOM, which shows up as "ï»¿" once the body is
// decoded as latin-1.
const bomPrefix = /^(\uFEFF|ï»¿)/;

export const stripBom = (text: string): string => text.replace(bomPrefix, '');

// zaragoza.es drops accented characters from `destinos` ("ESTACIN DELICIAS"),
// and avanzagrupo.com simply types some names without them ("ESTACION").
// Both forms map to the same accented word.
const wordReplacements: Record<string, string> = {
  aljafera: 'aljafería',
  aljaferia: 'aljafería',
  aragn: 'aragón',
  aragon: 'aragón',
  betore: 'betoré',
  catalua: 'cataluña',
  cataluna: 'cataluña',
  constitucin: 'constitución',
  constitucion: 'constitución',
  espaa: 'españa',
  espana: 'españa',
  estacin: 'estación',
  estacion: 'estación',
  estimacin: 'estimación',
  estimacion: 'estimación',
  futbol: 'fútbol',
  itaca: 'ítaca',
  jess: 'jesús',
  jesus: 'jesús',
  joaquin: 'joaquín',
  jos: 'josé',
  jose: 'josé',
  malibran: 'malibrán',
  minguijn: 'minguijón',
  minguijon: 'minguijón',
  montaana: 'montañana',
  montanana: 'montañana',
  pabelln: 'pabellón',
  pabellon: 'pabellón',
  peaflor: 'peñaflor',
  penaflor: 'peñaflor',
  piln: 'pilón',
  pilon: 'pilón',
  prncipe: 'príncipe',
  principe: 'príncipe',
  rio: 'río',
  tio: 'tío',
  tomas: 'tomás',
  tranva: 'tranvía',
  tranvia: 'tranvía',
  turstico: 'turístico',
  turistico: 'turístico',
  via: 'vía',
};

// "Quinto" is also a municipality, so only rewrite it inside the plaza name.
const phraseReplacements: [RegExp, string][] = [
  [/\bcarlos\s+quinto\b/g, 'carlos V'],
];

// \b would treat the accent in "josé" as a boundary and let "jos" match again
// inside a word an earlier pass already fixed. Compiled once: these run over
// every stop name of every line on an update.
const wordPatterns: [RegExp, string][] = Object.entries(wordReplacements).map(
  ([wrong, correct]) => [
    new RegExp(`(?<![\\p{L}\\p{N}])${wrong}(?![\\p{L}\\p{N}])`, 'giu'),
    correct,
  ],
);

const matchCase = (original: string, replacement: string): string => {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

// Stop names carry abbreviations whose casing matters ("I.E.S", "Mª",
// "C.M.E."), so only the accents are repaired and the rest is left alone.
export const restoreAccents = (text: string): string => {
  let fixed = stripBom(fixMojibake(text));
  for (const [pattern, correct] of wordPatterns) {
    fixed = fixed.replace(pattern, (match) => matchCase(match, correct));
  }
  return fixed;
};

// The same stop name arrives with different spacing from each KML, so compare
// and store it in one shape.
export const normalizeStreet = (text: string): string =>
  restoreAccents(text).replace(/\s+/g, ' ').trim();

export const fixWords = (text: string): string => {
  let fixed = stripBom(fixMojibake(text)).trim().toLowerCase();
  fixed = fixed.replace(/�/g, '');
  fixed = fixed.replace(/\bn0\b/g, 'nº');
  for (const [pattern, correct] of phraseReplacements) {
    fixed = fixed.replace(pattern, correct);
  }
  for (const [pattern, correct] of wordPatterns) {
    fixed = fixed.replace(pattern, correct);
  }
  return fixed;
};

// Lines whose KML exists but that avanzagrupo.com leaves out of the
// lineas-y-horarios dropdown. Anything else the dropdown stops offering is
// treated as withdrawn from the network and hidden (line 24 was).
export const extraLineIds = ['EM1', 'EM2'];

// Names as published on https://zaragoza.avanzagrupo.com/lineas-y-horarios/,
// with the accents the site omits restored. EM1/EM2 come from their KML
// document titles.
export const canonicalLineNames: Record<string, string> = {
  '21': 'Barrio Jesús - Oliver Miralbueno',
  '22': 'Las Fuentes - Bombarda',
  '23': 'Parque Venecia - Siglo XXI',
  '25': 'La Cartuja - Puerta del Carmen',
  '28': 'Coso - Montañana/Peñaflor',
  '29': 'Camino de las Torres - San Gregorio',
  '30': 'Las Fuentes - Plaza Aragón',
  '31': 'Puerto Venecia - Aljafería',
  '32': 'Santa Isabel - Bombarda',
  '33': 'Pinares de Venecia - Delicias',
  '34': 'Estación Delicias - Cementerio',
  '35': 'Parque Goya - Seminario',
  '36': 'Picarral - Valdefierro',
  '38': 'Bajo Aragón - Valdefierro',
  '39': 'Pinares de Venecia - Vadorrey',
  '40': 'San José - Plaza Aragón',
  '41': 'Puerta del Carmen - Rosales del Canal',
  '42': 'La Paz - Actur Rey Fernando',
  '43': 'Juslibol - Actur Rey Fernando',
  '44': 'Estación Miraflores - Actur Rey Fernando',
  '50': 'Vadorrey - San Gregorio',
  '51': 'Pabellón Príncipe Felipe - Estación Delicias',
  '52': 'Miralbueno - Puerta del Carmen',
  '53': 'Plaza Emperador Carlos V - Miralbueno',
  '54': 'Rosales del Canal - Tranvía',
  '55': 'Montecanal - Tranvía',
  '56': 'Valdespartera - Tranvía',
  '57': 'Casablanca - Tranvía',
  '58': 'Fuente de la Junquera - Tranvía',
  '59': 'Arcosur - Tranvía',
  '60': 'Avda. Estudiantes - Actur Rey Fernando',
  C1: 'Plaza de las Canteras - Complejo Funerario',
  C4: 'Plaza de las Canteras - Puerto Venecia',
  Ci1: 'Circular 1',
  Ci2: 'Circular 2',
  Ci3: 'Circular 3',
  Ci4: 'Circular 4',
  EM1: 'Plaza Europa - Estadio Modular',
  EM2: 'Paseo de la Ribera - Estadio Modular',
  N1: 'Plaza Aragón - La Jota Vadorrey Santa Isabel',
  N2: 'Pza. Aragón - La Almozara - Actur Rey F. - P. Goya - Arrabal',
  N3: 'Paseo Pamplona - Delicias - Valdefierro - Miralbueno',
  N4: 'Paseo Pamplona - Romareda - Rosales del Canal - Arcosur',
  N5: 'Pza. Aragón - Las Fuentes S José La Paz Parque Venecia',
  N6: 'Paseo Pamplona - Plaza Roma - Vía Hispanidad - La Cartuja',
  N7: 'Plaza Aragón - Arrabal San Gregorio Peñaflor',
  TUR: 'Turístico Diurno',
};

const lineIdsByUppercase = new Map(
  Object.keys(canonicalLineNames).map((id) => [id.toUpperCase(), id]),
);

// Arrival feeds report line ids in upper case ("CI3", "EM1"), which plain
// capitalize() would turn into "Ci3"/"Em1" — only the first is right.
export const normalizeLineId = (id: string): string => {
  const trimmed = stripBom(fixMojibake(id ?? '')).trim();
  if (!trimmed) return capitalize(trimmed);
  return lineIdsByUppercase.get(trimmed.toUpperCase()) ?? capitalize(trimmed);
};

// Listings show the numbered lines first, the lettered ones (C, Ci, EM, TUR)
// after them, and the night lines (N1-N7) last.
const lineGroup = (id: string): number => {
  if (/^\d+$/.test(id)) return 0;
  if (/^N\d+$/i.test(id)) return 2;
  return 1;
};

// Numeric collation keeps "Ci10" after "Ci9" and "N2" after "N1".
const lineCollator = new Intl.Collator('es', { numeric: true });

export const compareLineIds = (a: string, b: string): number =>
  lineGroup(a) - lineGroup(b) || lineCollator.compare(a, b);

const accentedChars = /[áéíóúüñÁÉÍÓÚÜÑ]/g;

const shoutRatio = (text: string): number => {
  const letters = text.replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g, '');
  if (!letters) return 0;
  return (
    (letters.length - letters.replace(/[A-ZÁÉÍÓÚÜÑ]/g, '').length) /
    letters.length
  );
};

// The same stop is named slightly differently in each line's KML ("Campus Rio
// Ebro" vs "Campus Río Ebro"). Pick one deterministically instead of letting
// whichever KML finishes last win.
export const pickCanonicalStreet = (names: string[]): string => {
  const variants = [...new Set(names.map(normalizeStreet).filter(Boolean))];

  return (
    variants.sort((a, b) => {
      const accents =
        (b.match(accentedChars)?.length ?? 0) -
        (a.match(accentedChars)?.length ?? 0);
      if (accents) return accents;

      const shouty =
        (shoutRatio(a) > 0.8 ? 1 : 0) - (shoutRatio(b) > 0.8 ? 1 : 0);
      if (shouty) return shouty;

      if (a.length !== b.length) return b.length - a.length;
      return a.localeCompare(b);
    })[0] ?? ''
  );
};

// Route files are not linked anywhere, so they are addressed by convention:
// <line>-1.kml for the outbound trip and <line>-2.kml for the return one. Only
// the WordPress upload folder varies, and a line that runs in one direction has
// no -2 file — the caller treats a missing file as "no stops from here" rather
// than as an error, so nothing but the folder has to be pinned.
const defaultKmlFolder = '2019/12';

const kmlFolders: Record<string, string> = {
  Ci3: '2025/03',
  Ci4: '2025/03',
  EM1: '2025/08',
  EM2: '2025/08',
  TUR: '2024/02',
};

export const KmlForLine = (lineId: string): string[] => {
  const folder = kmlFolders[lineId] ?? defaultKmlFolder;
  return [1, 2].map(
    (direction) =>
      `https://zaragoza.avanzagrupo.com/wp-content/uploads/${folder}/${lineId}-${direction}.kml`,
  );
};
