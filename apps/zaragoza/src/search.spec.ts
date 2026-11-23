import { searchStations } from './search';

const stations = [
  {
    id: '720',
    street: 'Plaza España',
    lines: ['21', '35'],
    coordinates: ['-0.8806', '41.6508'],
  },
  {
    id: '1300',
    street: 'Paseo Independencia 24',
    lines: ['22'],
    coordinates: ['-0.8812', '41.6498'],
  },
  { id: '17', street: 'Avenida de Valencia', lines: ['C1'], coordinates: [] },
];

const describe_ = () => undefined;

describe('searchStations', () => {
  it('finds a stop by the start of its name', () => {
    const hits = searchStations(
      stations,
      'plaza esp',
      'bus-stop',
      describe_,
    ).filter((h) => h.score > 0);
    expect(hits.map((h) => h.id)).toEqual(['720']);
    expect(hits[0].coordinates).toEqual([-0.8806, 41.6508]);
  });

  it('puts the stop with exactly that number first', () => {
    const hits = searchStations(stations, '720', 'bus-stop', describe_).sort(
      (a, b) => b.score - a.score,
    );
    expect(hits[0].id).toBe('720');
    expect(hits[0].score).toBeGreaterThan(50);
  });

  it('finds the stops a line serves', () => {
    const hits = searchStations(stations, '35', 'bus-stop', describe_).filter(
      (h) => h.score > 0,
    );
    expect(hits.map((h) => h.id)).toEqual(['720']);
  });

  it('leaves a stop without a point unplaced rather than at null island', () => {
    const [hit] = searchStations(
      stations,
      'valencia',
      'bus-stop',
      describe_,
    ).filter((h) => h.score > 0);
    expect(hit.coordinates).toBeUndefined();
  });
});
