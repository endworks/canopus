import {
  combinedTitle,
  OperatorLine,
  OperatorStop,
  parseOperatorLine,
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

describe('combinedTitle', () => {
  it('is the one name where both directions call at the same place', () => {
    expect(
      combinedTitle([
        stop(1, '1902', 'Casablanca', 1, 2, [41.64, -0.92]),
        stop(2, '1901', 'Casablanca', 1, 1, [41.64, -0.92]),
      ]),
    ).toBe('Casablanca');
  });

  it('is both names where they call at different ones', () => {
    // Northbound calls at Margarita Xirgu and southbound at García Abril, a
    // street apart. Either name alone is wrong for half the travellers.
    expect(
      combinedTitle([
        stop(2, '0502', 'García Abril', 1, 1, [41.67, -0.89]),
        stop(1, '0501', 'Margarita Xirgu', 1, 2, [41.67, -0.89]),
      ]),
    ).toBe('Margarita Xirgu / García Abril');
  });

  it('names them in the same order whichever way round it is asked', () => {
    const a = stop(1, '0501', 'Margarita Xirgu', 1, 2, [41.67, -0.89]);
    const b = stop(2, '0502', 'García Abril', 1, 1, [41.67, -0.89]);

    expect(combinedTitle([a, b])).toBe(combinedTitle([b, a]));
  });

  it('is the stop itself where the feed pairs it with nothing', () => {
    expect(
      combinedTitle([stop(1, '2502', 'Mago de Oz', 1, 99, [41.62, -0.93])]),
    ).toBe('Mago de Oz');
  });
});

describe('parseOperatorLine', () => {
  it('takes the stops of each direction in the order the operator runs them', () => {
    const { line } = parseOperatorLine(feed());

    expect(line.id).toBe('L1');
    expect(line.stations).toEqual(['2502', '2402', '1902', '0102']);
    // Not the outbound list reversed: the return leg calls at its own stops,
    // and at the far end of the line at different places altogether.
    expect(line.stationsReturn).toEqual(['0101', '1901', '2401', '2501']);
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

  it('gives every stop the combined name of the place it stands at', () => {
    const { stations } = parseOperatorLine(feed());
    const byId = new Map(stations.map((station) => [station.id, station]));

    // Both stops of the split place carry both names, so a traveller reading
    // either one is told where they are whichever way they are going.
    expect(byId.get('2402').street).toBe(
      'Cantando bajo la Lluvia / Un Americano en París',
    );
    expect(byId.get('2401').street).toBe(
      'Cantando bajo la Lluvia / Un Americano en París',
    );
    expect(byId.get('1902').street).toBe('Casablanca');
  });

  it('gives the line the combined name at a terminus too', () => {
    const split = feed();
    split.stops_1[0].displayName = 'Academia General Militar';

    expect(parseOperatorLine(split).line.name).toBe(
      'Mago de Oz - Academia General Militar / Avenida de la Academia',
    );
  });

  it('stores each stop where the operator puts it', () => {
    const { stations } = parseOperatorLine(feed());
    const mago = stations.find((station) => station.id === '2502');

    expect(mago.coordinates).toEqual(['-0.93694', '41.62435']);
  });

  it('leaves out a stop whose point is not a place in Zaragoza', () => {
    const wrong = feed();
    wrong.stops_0[1].lat = '';
    wrong.stops_0[2].lat = '0';

    const { stations, line } = parseOperatorLine(wrong);

    expect(stations.map((station) => station.id)).not.toContain('2402');
    expect(stations.map((station) => station.id)).not.toContain('1902');
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
