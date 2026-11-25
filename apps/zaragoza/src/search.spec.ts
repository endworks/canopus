import { rankHits } from '@canopus/shared';
import { searchLines, searchStations } from './search';
import { boardsOf } from './tram-line';

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

describe('numbers', () => {
  const lines = [
    { id: '35', name: 'Parque Goya - Vía Hispanidad' },
    { id: 'Ci2', name: 'Circular 2' },
    { id: '99', name: 'Hidden', hidden: true },
  ];

  it('reads a bare number as the line, then the bus stop, then the dock', () => {
    const hits = rankHits(
      [
        ...searchStations(
          [{ id: '35', street: 'Echegaray. Pte. Piedra' }],
          '35',
          'bizi-station',
          describe_,
        ),
        ...searchStations(
          [{ id: '35', street: 'Coso' }, ...stations],
          '35',
          'bus-stop',
          describe_,
        ),
        ...searchLines(lines, '35', 'bus-line', (l) => `Línea ${l.id}`),
      ],
      10,
    );
    expect(hits.slice(0, 3).map((h) => `${h.type}:${h.id}`)).toEqual([
      'bus-line:35',
      'bus-stop:35',
      'bizi-station:35',
    ]);
  });

  it('finds a line by its code in any case, and not a hidden one', () => {
    expect(
      searchLines(lines, 'ci2', 'bus-line', (l) => l.id)
        .filter((h) => h.score > 0)
        .map((h) => h.id),
    ).toEqual(['Ci2']);
    expect(
      searchLines(lines, '99', 'bus-line', (l) => l.id).filter(
        (h) => h.score > 0,
      ),
    ).toEqual([]);
  });

  it('finds a tram stop by the number on its platform, not its place code', () => {
    const tram = [{ id: '1300', street: 'Plaza de España' }];
    const platform = searchStations(tram, '1301', 'tram-stop', describe_, (s) =>
      boardsOf(s.id),
    );
    const place = searchStations(tram, '1300', 'tram-stop', describe_, (s) =>
      boardsOf(s.id),
    );
    expect(platform[0].score).toBeGreaterThan(45);
    expect(place[0].score).toBe(0);
  });
});
