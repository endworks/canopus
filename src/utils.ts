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
  return /^[IVXLCDM]+$/.test(upper);
};

const alwaysLowercaseWords = ['y', 'a', 'de', 'en', 'del', 'la', 'los', 'las'];

export const capitalizeEachWord = (
  text: string,
  setLowercase: boolean = true
) => {
  if (text) {
    return text
      .split(' ')
      .map((word, i) => {
        const lower = word.toLowerCase();

        if (alwaysLowercaseWords.includes(lower) && i > 0) {
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

export const isInt = (number: number | string) => {
  if (typeof number == 'number') {
    return true;
  } else if (typeof number != 'string') {
    return false;
  }
  return !isNaN(parseFloat(number));
};

const wordReplacements: Record<string, string> = {
  aragon: 'aragón',
  aragn: 'aragón',
  jess: 'jesús',
  peaflor: 'peñaflor',
  via: 'vía',
  espaa: 'españa',
  espana: 'españa',
  quinto: 'V',
  aljafera: 'aljafería',
  minguijn: 'minguijón',
  pilon: 'pilón',
  estimacin: 'estimación',
  jos: 'josé',
  'Ã“': 'Ó',
  'Ã': 'Í',
  'Ã‰': 'É'
};

export const fixWords = (text: string): string => {
  let fixed = text.trim().toLowerCase();
  fixed = fixed.replace(/�/g, '');
  fixed = fixed.replace('n0', 'n');
  for (const [wrong, correct] of Object.entries(wordReplacements)) {
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    fixed = fixed.replace(regex, correct);
  }
  return fixed;
};

export const KmlForLine = (lineId: string): string[] => {
  const kml = {
    Ci3: [
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2025/03/Ci3-1.kml'
    ],
    Ci4: [
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2025/03/Ci4-1.kml'
    ],
    EM1: [
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2025/08/EM1-1.kml',
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2025/08/EM1-2.kml'
    ],
    EM2: [
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2025/08/EM2-1.kml',
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2025/08/EM2-2.kml'
    ],
    TUR: [
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2024/02/TUR-1.kml',
      'https://zaragoza.avanzagrupo.com/wp-content/uploads/2024/02/TUR-2.kml'
    ]
  };
  if (Object.keys(kml).includes(lineId)) {
    return kml[lineId];
  }

  const singleDestinationLines = [
    '30',
    '54',
    '55',
    '56',
    '57',
    '58',
    '59',
    'N1',
    'N3',
    'N4',
    'N5',
    'N7'
  ];
  if (singleDestinationLines.includes(lineId)) {
    return [
      `https://zaragoza.avanzagrupo.com/wp-content/uploads/2019/12/${lineId}-1.kml`
    ];
  }

  return [
    `https://zaragoza.avanzagrupo.com/wp-content/uploads/2019/12/${lineId}-1.kml`,
    `https://zaragoza.avanzagrupo.com/wp-content/uploads/2019/12/${lineId}-2.kml`
  ];
};
