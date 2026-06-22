export const minutesToString = (min: number): string => {
  const hour = Math.floor(min / 60);
  const minutes = min % 60;
  return `${hour}h${minutes > 0 ? ` ${minutes}m` : ''}`;
};

export const sanitizeTitle = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/[:,.]/gm, '')
    .replace(/á/gm, 'a')
    .replace(/ā/gm, 'a')
    .replace(/é/gm, 'e')
    .replace(/í/gm, 'i')
    .replace(/ó/gm, 'o')
    .replace(/ú/gm, 'u')
    .replace(/ñ/gm, 'n')
    .trim();
};

export const generateSlug = (title: string): string => {
  return sanitizeTitle(title).replace(/\s/gm, '-');
};

export const cacheTTL = 60 * 60 * 6;
export const cacheMaxSize = 256;
