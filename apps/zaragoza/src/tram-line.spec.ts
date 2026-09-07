import {
  boardsOf,
  OperatorLine,
  OperatorStop,
  parseOperatorLine,
  stopCode,
  TRAM_LINE_ID,
  tramLineId,
} from './tram-line';

/**
 * A stretch of the real thing, in the shape the operator's feed gives it: a
 * stop each way at each place, paired by `sibling_id`, and the whole of it in
 * `position` order along its own direction.
 */
const stop = (
  id: number,
  name: string,
  displayName: string,
  position: number,
  sibling: number,
  [lat, lng]: [number, number],
): OperatorStop => ({
  id,
  name,
  displayName,
  lat: `${lat}`,
  lng: `${lng}`,
  position,
  sibling_id: sibling,
});

// Southbound and northbound, four places, the last of which the two
// directions call at under different names — as seven of this line's places
// really do.
const feed = (): OperatorLine => ({
  stops_0: [
    stop(1, '2502', 'Mago de Oz', 1, 51, [41.62435, -0.93694]),
    stop(2, '2402', 'Un Americano en París', 2, 52, [41.63, -0.93]),
    stop(3, '1902', 'Casablanca', 3, 53, [41.64, -0.92]),
    stop(4, '0102', 'Avenida de la Academia', 4, 54, [41.68832, -0.87074]),
  ],
  stops_1: [
    stop(54, '0101', 'Avenida de la Academia', 1, 4, [41.68833, -0.87075]),
    stop(53, '1901', 'Casablanca', 2, 3, [41.64001, -0.92001]),
    stop(52, '2401', 'Cantando bajo la Lluvia', 3, 2, [41.63001, -0.93001]),
    stop(51, '2501', 'Mago de Oz', 4, 1, [41.62436, -0.93695]),
  ],
  points_0: [
    ['41.62435', '-0.93694'],
    [41.63, -0.93],
    [41.64, -0.92],
    ['41.68832', '-0.87074'],
  ],
  points_1: [
    [41.68832, -0.87074],
    [41.64, -0.92],
    [41.63, -0.93],
    [41.62435, -0.93694],
  ],
});

describe('tramLineId', () => {
  it.each([
    ['the feed writes the line as a bare number', '1', 'L1'],
    ['the network writes it with its letter', 'L1', 'L1'],
    ['a feed shouting, or not', 'l1', 'L1'],
    ['a number padded the way the bus feeds pad theirs', '01', 'L1'],
  ])('%s', (_name, raw, expected) => {
    expect(tramLineId(raw)).toBe(expected);
  });

  it('is what the network calls its line', () => {
    expect(tramLineId('1')).toBe(TRAM_LINE_ID);
  });

  it('leaves alone a label it does not recognise', () => {
    expect(tramLineId('Lanzadera')).toBe('Lanzadera');
    expect(tramLineId('')).toBe('');
  });
});

describe('stopCode', () => {
  it('is the operator code without the padding the city does not use', () => {
    expect(stopCode('0101')).toBe('101');
    expect(stopCode('2502')).toBe('2502');
  });
});

describe('boardsOf', () => {
  it('reads both platforms of a place the tram calls at each way', () => {
    expect(boardsOf('2500')).toEqual(['2501', '2502']);
    // The padding goes here too, so a board is asked for by the id it answers
    // to rather than by the one the operator writes.
    expect(boardsOf('100')).toEqual(['101', '102']);
  });

  it('reads only its own where the tram calls one way', () => {
    expect(boardsOf('2401')).toEqual(['2401']);
    expect(boardsOf('2422')).toEqual(['2422']);
  });
});

describe('parseOperatorLine', () => {
  it('takes the stops of each direction in the order the operator runs them', () => {
    const { line } = parseOperatorLine(feed());

    expect(line.id).toBe('L1');
    // A place both directions call at is named once, under the code its two
    // platforms share with a nought for the direction; a place only one of
    // them calls at keeps its own code.
    expect(line.stations).toEqual(['2500', '2402', '1900', '100']);
    // Not the outbound list reversed: the return leg calls at the same places
    // where there is one, and at a different stop where there is not.
    expect(line.stationsReturn).toEqual(['100', '1900', '2401', '2500']);
  });

  it('has one record for a place and two for a pair that is not one', () => {
    const { stations } = parseOperatorLine(feed());

    expect(stations.map((station) => station.id).sort()).toEqual([
      '100',
      '1900',
      '2401',
      '2402',
      '2500',
    ]);
  });

  it('takes the track the operator draws, each way its own', () => {
    const { line } = parseOperatorLine(feed());

    // Longitude first, which is how this service stores a point and the
    // reverse of how the feed writes one.
    expect(line.path[0]).toEqual([-0.93694, 41.62435]);
    expect(line.pathReturn[0]).toEqual([-0.87074, 41.68832]);
    expect(line.path).toHaveLength(4);
  });

  it('names the line after the places its outbound leg runs between', () => {
    expect(parseOperatorLine(feed()).line.name).toBe(
      'Mago de Oz - Avenida de la Academia',
    );
  });

  it('calls each stop of a split place its own name, not both', () => {
    const { stations } = parseOperatorLine(feed());
    const byId = new Map(stations.map((station) => [station.id, station]));

    // Two stops on two streets, and a traveller at one cannot catch what
    // calls at the other, so neither is told the other's name.
    expect(byId.get('2402').street).toBe('Un Americano en París');
    expect(byId.get('2401').street).toBe('Cantando bajo la Lluvia');
    expect(byId.get('1900').street).toBe('Casablanca');
  });

  it('is the name that decides, not the code the two stops share', () => {
    // `2402` and `2401` share a place code and are still two streets apart,
    // as five of this line's seven split places really are.
    const { stations } = parseOperatorLine(feed());

    expect(stations.map((station) => station.id)).toContain('2402');
    expect(stations.map((station) => station.id)).toContain('2401');
    expect(stations.map((station) => station.id)).not.toContain('2400');
  });

  it('puts a place the tram calls at each way between its platforms', () => {
    const { stations } = parseOperatorLine(feed());
    const mago = stations.find((station) => station.id === '2500');

    // Between (41.62435, -0.93694) and (41.62436, -0.93695), longitude first
    // and to the five decimal places a point is kept to.
    expect(mago.coordinates).toEqual(['-0.93694', '41.62436']);
  });

  it('leaves a one-way stop exactly where the operator puts it', () => {
    const { stations } = parseOperatorLine(feed());
    const paris = stations.find((station) => station.id === '2402');

    expect(paris.coordinates).toEqual(['-0.93', '41.63']);
  });

  it('places a pair by the platform it can read when the other is unreadable', () => {
    const half = feed();
    half.stops_0[2].lat = '';

    const { stations } = parseOperatorLine(half);
    const casablanca = stations.find((station) => station.id === '1900');

    // One platform of a pair is enough to know where the place is, and half a
    // pin is better than none.
    expect(casablanca.coordinates).toEqual(['-0.92001', '41.64001']);
  });

  it('leaves out a stop whose point is not a place in Zaragoza', () => {
    const wrong = feed();
    wrong.stops_0[1].lat = '';
    wrong.stops_0[2].lat = '0';
    wrong.stops_1[1].lat = '0';

    const { stations, line } = parseOperatorLine(wrong);

    expect(stations.map((station) => station.id)).not.toContain('2402');
    expect(stations.map((station) => station.id)).not.toContain('1900');
    // The route still runs through them: a stop we cannot place is still a
    // stop the tram calls at, and dropping it from the line would be a worse
    // lie than not knowing where it is.
    expect(line.stations).toContain('2402');
  });

  it('reads nothing from a feed that is not a line', () => {
    expect(parseOperatorLine(undefined)).toBeNull();
    expect(parseOperatorLine({})).toBeNull();
    expect(parseOperatorLine({ stops_0: feed().stops_0 })).toBeNull();
    expect(
      parseOperatorLine({
        stops_0: [feed().stops_0[0]],
        stops_1: [feed().stops_1[0]],
      }),
    ).toBeNull();
  });
});
