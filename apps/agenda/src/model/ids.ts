import { randomBytes } from 'crypto';

/**
 * The agenda's ids: a type prefix and a ULID, `evt_01JD3Q8Z4K7M2N5P8R0T3V6X9Y`.
 *
 * Opaque on purpose (docs/agenda/README.md, decision 1). Nothing about a title,
 * a date or a source's key goes into one, because all three change and an id
 * a reader has saved must not. The ULID's time prefix only makes them sort in
 * the order they were made, which is handy in a database and means nothing
 * else.
 */
export const ID_PREFIXES = {
  series: 'ser',
  event: 'evt',
  occurrence: 'occ',
  place: 'plc',
  agent: 'agt',
  notice: 'ntc',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** Crockford's base 32: no I, L, O or U to misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ulid = (now = Date.now(), random = randomBytes(16)): string => {
  let time = '';
  let rest = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  let tail = '';
  for (let i = 0; i < 16; i++) tail += ALPHABET[random[i] % 32];
  return time + tail;
};

export const newId = (kind: IdKind): string => `${ID_PREFIXES[kind]}_${ulid()}`;

/** A slug from a title, for readable URLs. It may change; ids may not. */
export const slugify = (text: string): string =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sin-titulo';
