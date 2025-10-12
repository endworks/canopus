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

const alwaysLowercaseWords = ['y', 'a', 'de', 'del', 'la'];

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
  aragn: 'aragón',
  jess: 'jesús',
  peaflor: 'peñaflor',
  via: 'vía',
  espaa: 'españa',
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

type ZaragozaLine = { value: string; label: string };

export const fetchZaragozaLines = async (): Promise<ZaragozaLine[]> => {
  try {
    const response = await fetch(
      'https://nps.avanzagrupo.com/lineas_zaragoza.js'
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const scriptText = await response.text();

    const startMarker = 'const ZARAGOZA_LINES = ';
    const endMarker = ';';

    const startIndex = scriptText.indexOf(startMarker);
    const endIndex = scriptText.lastIndexOf(endMarker);

    if (startIndex === -1 || endIndex === -1) {
      throw new Error('Variable definition markers not found in script.');
    }

    const rawArrayString = scriptText
      .substring(startIndex + startMarker.length, endIndex)
      .trim();

    let cleanJsonString = rawArrayString;
    cleanJsonString = cleanJsonString
      .replace(/value:/g, '"value":')
      .replace(/label:/g, '"label":');
    cleanJsonString = cleanJsonString.replace(/'/g, '"');
    const linesArray = JSON.parse(cleanJsonString);

    return linesArray;
  } catch (error) {
    console.error('Failed to fetch or parse Zaragoza lines data:', error);
    throw error;
  }
};
