import { BusAlertSchema, BusLineSchema } from './bus.schema';
import { TramAlertSchema, TramLineSchema } from './tram.schema';

/**
 * The alert and the line are defined once and subclassed per network, so what
 * is actually stored depends on Mongoose reading a base class's fields through
 * the subclass. If it ever stopped, every one of these collections would go on
 * accepting writes and quietly keep an id and nothing else — which no test
 * built on a fake model could see.
 */
describe('the fields a subclassed schema keeps', () => {
  const alertPaths = [
    'id',
    'title',
    'url',
    'date',
    'lines',
    'stations',
    'addedStations',
    'scope',
    'startDate',
    'endDate',
    'articleHash',
    'firstSeen',
  ];

  const linePaths = [
    'id',
    'name',
    'color',
    'stations',
    'stationsReturn',
    'path',
    'pathReturn',
    'withdrawn',
    'lastUpdated',
  ];

  it.each([
    ['bus alerts', BusAlertSchema, alertPaths],
    ['tram alerts', TramAlertSchema, alertPaths],
    ['bus lines', BusLineSchema, linePaths],
    ['tram lines', TramLineSchema, linePaths],
  ])('%s', (_name, schema, paths) => {
    expect(Object.keys(schema.paths)).toEqual(expect.arrayContaining(paths));
  });

  it('keeps each network in its own collection', () => {
    expect(BusAlertSchema.get('collection')).toBe('bus_alerts');
    expect(TramAlertSchema.get('collection')).toBe('tram_alerts');
    expect(BusLineSchema.get('collection')).toBe('bus_lines');
    expect(TramLineSchema.get('collection')).toBe('tram_lines');
  });
});
