import { RegionAtlas } from './region-atlas';

/**
 * Real coordinates against the real atlas.
 *
 * No fixture: the file this reads is the deliverable, built by
 * `scripts/build-regions.mjs` from the public map, and a stub would only prove
 * the ray casting works on a square somebody drew for it. What is worth
 * asserting is that the shipped outlines put real towns in the right country.
 */
describe('RegionAtlas.locate', () => {
  const atlas = new RegionAtlas();

  it('names the country a coordinate is in', () => {
    // Zaragoza, Toulouse, Porto, Milan — each a couple of hundred kilometres
    // from a border, so a wrong answer is a wrong map rather than a rounding.
    expect(atlas.locate(41.6563, -0.8781)).toBe('ES');
    expect(atlas.locate(43.6047, 1.4442)).toBe('FR');
    expect(atlas.locate(41.1579, -8.6291)).toBe('PT');
    expect(atlas.locate(45.4642, 9.19)).toBe('IT');
  });

  it('does not answer for somewhere it has no map of', () => {
    // The atlas covers the countries MeteoAlarm participates in and no others,
    // so these have to come back empty rather than be claimed by the nearest
    // ring. A caller here supplies their own country or gets no warnings.
    expect(atlas.locate(-12.0464, -77.0428)).toBeUndefined(); // Lima
    expect(atlas.locate(35.6762, 139.6503)).toBeUndefined(); // Tokyo
  });

  it('does not put the open sea in a country', () => {
    // Four hundred kilometres west of Portugal. Bounding boxes reach out here
    // and the rings do not, which is the whole reason `inside` tests both.
    expect(atlas.locate(39.5, -13.5)).toBeUndefined();
  });

  it('agrees with the narrowing it is the other half of', () => {
    // The point `locate` claims for Spain is a point `covering` can place in a
    // Spanish region. If these two ever disagreed, a warning would be fetched
    // from a national feed and then filtered out of its own country.
    const country = atlas.locate(41.6563, -0.8781);
    expect(country).toBe('ES');
    expect(
      atlas.covering(country as string, 41.6563, -0.8781).length,
    ).toBeGreaterThan(0);
  });
});
