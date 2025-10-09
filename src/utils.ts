import vm from 'vm';

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
      .map((word) => {
        const lower = word.toLowerCase();

        if (alwaysLowercaseWords.includes(lower)) {
          return lower;
        }

        if (isRomanNumeral(word)) {
          return word.toUpperCase();
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
  n0: 'n',
  'Ã“': 'Ó',
  'Ã': 'Í',
  'Ã‰': 'É'
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

export const fetchZaragozaLines = async (): Promise<
  { value: string; label: string }[]
> => {
  const response = await fetch(
    'https://nps.avanzagrupo.com/lineas_zaragoza.js'
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch script: ${response.statusText}`);
  }

  const scriptContent = await response.text();

  const sandbox: any = {};
  const context = vm.createContext(sandbox);

  const script = new vm.Script(scriptContent);
  script.runInContext(context);

  if (!sandbox.ZARAGOZA_LINES) {
    throw new Error('ZARAGOZA_LINES not defined in script');
  }

  return sandbox.ZARAGOZA_LINES;
};
