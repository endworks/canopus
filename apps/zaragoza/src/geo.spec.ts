import { inZaragoza, parseKmlPath, round5 } from './geo';

describe('round5', () => {
  it('keeps a point to the metre', () => {
    expect(round5(-0.9019712)).toBe(-0.90197);
  });
});

describe('inZaragoza', () => {
  it.each([
    ['a stop on the line', [-0.90197, 41.68716], true],
    ['Madrid', [-3.7038, 40.4168], false],
    ['the null island a bad parse produces', [0, 0], false],
  ])('%s', (_name, point, expected) => {
    expect(inZaragoza(point as [number, number])).toBe(expected);
  });
});

describe('parseKmlPath', () => {
  it('reads the line a route file draws', () => {
    expect(
      parseKmlPath(`<?xml version="1.0"?>
        <kml><Document><Placemark><LineString><coordinates>
          -0.9019712,41.6871633,0.0 -0.8995901,41.6817212,0.0
        </coordinates></LineString></Placemark></Document></kml>`),
    ).toEqual([
      [-0.90197, 41.68716],
      [-0.89959, 41.68172],
    ]);
  });

  it('reads nothing from a file that draws no line', () => {
    expect(parseKmlPath('<kml><Document/></kml>')).toEqual([]);
  });
});
