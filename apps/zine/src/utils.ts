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
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const generateSlug = (title: string): string =>
  sanitizeTitle(title).replace(/\s/g, '-');

/**
 * A venue name without the generic 'Cine'/'Cines' prefix, which says nothing
 * about which venue it is: it neither identifies a venue nor orders a list.
 */
export const venueKey = (name: string): string =>
  sanitizeTitle(name).replace(/^cines?\s+/, '');

/** cache-manager v7 TTLs are milliseconds. Six hours. */
export const cacheTTL = 1000 * 60 * 60 * 6;

const bigrams = (value: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const gram = value.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
};

/**
 * Sørensen-Dice coefficient over character bigrams, 0..1. Degrades smoothly:
 * punctuation, articles and word order cost a little, unrelated strings score
 * near zero. Used for both film titles and venue names.
 */
export const similarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let shared = 0;
  for (const [gram, count] of left) {
    shared += Math.min(count, right.get(gram) ?? 0);
  }
  return (2 * shared) / (a.length + b.length - 2);
};

/** Run an async map with a ceiling on how many run at once. */
export const mapWithLimit = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
};
