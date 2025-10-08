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
  return /^[IVXLCDM]+$/.test(word) && word === word.toUpperCase();
};

const alwaysLowercaseWords = ['y', 'de', 'del'];

export const capitalizeEachWord = (
  text: string,
  setLowercase: boolean = true
) => {
  if (text) {
    return text
      .split(' ')
      .map((word) => {
        const lower = word.toLowerCase();

        if (alwaysLowercaseWords.includes(lower)) {
          return lower;
        }

        if (isRomanNumeral(word)) {
          return word;
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
  n0: 'n'
};

export const fixWords = (text: string): string => {
  let fixed = text.trim().toLocaleLowerCase();
  fixed = fixed.replace(/�/g, '');
  for (const [wrong, correct] of Object.entries(wordReplacements)) {
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    fixed = fixed.replace(regex, correct);
  }
  return fixed;
};
