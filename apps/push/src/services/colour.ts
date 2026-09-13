/**
 * A colour the operator publishes, in the form the app's own `parseHexColor`
 * produces: opaque alpha over the six hex digits, and nothing at all for a
 * spelling neither end recognises.
 *
 * Added rather than or-ed. JavaScript's bitwise operators are 32-bit and
 * signed, so `0xff000000 | rgb` comes back negative — and the app reads this
 * as an `Int64` and would draw whatever a negative colour is.
 */
export const argb = (hex?: string): number | undefined => {
  const raw = hex?.trim().replace(/^#/, '');
  if (!raw) return undefined;
  const six =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (six.length !== 6 || !/^[0-9a-f]{6}$/i.test(six)) return undefined;
  const rgb = Number.parseInt(six, 16);
  return Number.isNaN(rgb) ? undefined : 0xff000000 + rgb;
};
