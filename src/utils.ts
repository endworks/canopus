export const capitalize = (text: string, setLowercase?: boolean) => {
  if (text) {
    if (setLowercase) {
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    } else {
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  }
  return null;
};

export const capitalizeEachWord = (text: string, setLowercase?: boolean) => {
  if (text) {
    if (text.indexOf(' ') > -1) {
      const words = text.split(' ');
      const capitalized = [];
      words.map((word) => {
        capitalized.push(capitalize(word, setLowercase));
      });
      return capitalized.join(' ');
    } else {
      return capitalize(text, setLowercase);
    }
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
  estimacin: 'estimación'
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
