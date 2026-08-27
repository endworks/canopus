import { europeanAqi } from './european-aqi';

describe('europeanAqi', () => {
  it('grades each pollutant on its own thresholds', () => {
    // One pollutant at a time, at the top of each band. The five scales are
    // different numbers for the same six words, which is the whole reason they
    // are a table rather than one ramp.
    expect(europeanAqi({ pm2_5: 5 })).toBe(1);
    expect(europeanAqi({ pm2_5: 15 })).toBe(2);
    expect(europeanAqi({ pm2_5: 50 })).toBe(3);
    expect(europeanAqi({ pm2_5: 90 })).toBe(4);
    expect(europeanAqi({ pm2_5: 140 })).toBe(5);
    expect(europeanAqi({ pm2_5: 141 })).toBe(6);

    expect(europeanAqi({ pm10: 15 })).toBe(1);
    expect(europeanAqi({ no2: 10 })).toBe(1);
    expect(europeanAqi({ o3: 60 })).toBe(1);
    expect(europeanAqi({ so2: 20 })).toBe(1);

    // The same number is a different grade depending on which gas it measures.
    expect(europeanAqi({ pm2_5: 50 })).toBe(3);
    expect(europeanAqi({ o3: 50 })).toBe(1);
  });

  it('takes the poorest pollutant rather than the average', () => {
    // The EEA's own rule. An average would let one pollutant at the top of the
    // scale read as moderate because the other four were clean, which is the
    // opposite of what an index warning people about the air is for.
    expect(europeanAqi({ pm2_5: 2, pm10: 5, no2: 5, o3: 30, so2: 200 })).toBe(
      5,
    );
  });

  it('answers nothing when nothing was measured', () => {
    // Not 1. A station that reported no pollutant has not said the air is good,
    // and the difference survives all the way to the client, which draws a
    // grade only where there is one.
    expect(europeanAqi({})).toBeUndefined();
    expect(europeanAqi({ pm2_5: undefined })).toBeUndefined();
  });

  it('ignores a pollutant the source could not measure', () => {
    // A partial answer is still an answer: four gases and a hole is graded on
    // the four, rather than thrown away for want of the fifth.
    expect(europeanAqi({ pm2_5: 12, o3: undefined })).toBe(2);
    expect(europeanAqi({ pm2_5: 12, so2: Number.NaN })).toBe(2);
    expect(europeanAqi({ pm2_5: 12, no2: -1 })).toBe(2);
  });
});
