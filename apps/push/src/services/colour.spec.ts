import { argb } from './colour';

describe('argb', () => {
  it('is the same number the app computes for itself', () => {
    // `parseHexColor` in the app's shared logic: 0xFF000000 or the six digits.
    expect(argb('#E30613')).toBe(4293068307);
    expect(argb('E30613')).toBe(4293068307);
    expect(argb('#f00')).toBe(4294901760);
  });

  it('is a positive number, which a bitwise or would not be', () => {
    // `0xff000000 | rgb` is a 32-bit signed operation in JavaScript and comes
    // back negative; Swift reads the value as an Int64 and would draw nonsense.
    expect(argb('#E30613')).toBeGreaterThan(0);
  });

  it('answers nothing rather than guessing', () => {
    for (const nonsense of [undefined, '', '#zzz', '#12', 'rebeccapurple']) {
      expect(argb(nonsense)).toBeUndefined();
    }
  });
});
