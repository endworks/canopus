export const minutesToString = (min: number): string => {
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
};

/**
 * Lowercase and strip accents/punctuation so scraped titles can be compared
 * against TheMovieDB results. NFD decomposition covers every diacritic, not
 * just the handful the Spanish listings happen to use.
 */
export const sanitizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[:,.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const generateSlug = (title: string): string =>
  sanitizeTitle(title).replace(/\s/g, '-');

/** cache-manager v7 TTLs are milliseconds. Six hours. */
export const cacheTTL = 1000 * 60 * 60 * 6;
