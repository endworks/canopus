/**
 * The air, as Europe grades it.
 *
 * Every provider here answers concentrations, and only OpenWeather answers an
 * index — its own, a one-to-five scale of its own devising that shares its
 * first five words with the European one and stops a band short of it. A reader
 * in Zaragoza has seen the European index on the news and on their city's own
 * site; handing them five familiar words on a different scale is worse than
 * handing them none, because the numbers look comparable and are not.
 *
 * So the index is computed here, from the concentrations, once, and both
 * providers are graded by the same table. The bands are the European
 * Environment Agency's own, in µg/m³:
 *
 * https://airindex.eea.europa.eu/AQI/index.html
 */

/** The six bands, low to high. What a client draws, and what a word names. */
export const EAQI_BANDS = 6;

/**
 * Where each pollutant's bands end, in µg/m³.
 *
 * Five thresholds per pollutant and six bands: the last is open at the top,
 * which is why it has no number. Read as "up to and including" — the EEA
 * publishes them as whole-number ranges, and a concentration that lands exactly
 * on a boundary belongs to the lower band.
 */
const THRESHOLDS: Record<string, number[]> = {
  pm2_5: [5, 15, 50, 90, 140],
  pm10: [15, 45, 120, 195, 270],
  no2: [10, 25, 60, 100, 150],
  o3: [60, 100, 120, 160, 180],
  so2: [20, 40, 125, 190, 275],
};

/** What a caller hands over, in µg/m³. Any subset: a missing one is not a zero. */
export type Concentrations = {
  pm2_5?: number | undefined;
  pm10?: number | undefined;
  no2?: number | undefined;
  o3?: number | undefined;
  so2?: number | undefined;
};

/** Which band one pollutant falls in, one to six. */
const band = (value: number, thresholds: number[]): number =>
  thresholds.filter((ceiling) => value > ceiling).length + 1;

/**
 * The grade, which is the worst of them rather than an average.
 *
 * The EEA's own rule: "the index corresponds to the poorest level for any of
 * the five pollutants". An average would let a city with one pollutant at the
 * top of the scale read as moderate because the other four were clean, which is
 * the opposite of what an index warning people about the air is for.
 *
 * Nothing measured is `undefined` rather than `1`. A station that reported no
 * pollutant has not told us the air is good, and a client that draws a grade
 * only where there is one is the reason this distinction is kept all the way
 * out to the wire.
 */
export function europeanAqi(
  concentrations: Concentrations,
): number | undefined {
  const grades = Object.entries(THRESHOLDS)
    .map(([pollutant, thresholds]) => {
      const value = concentrations[pollutant as keyof Concentrations];
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? band(value, thresholds)
        : undefined;
    })
    .filter((grade): grade is number => grade !== undefined);

  return grades.length ? Math.max(...grades) : undefined;
}
