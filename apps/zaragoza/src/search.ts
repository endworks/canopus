import { matchScore, SearchHit, SearchHitType } from '@canopus/shared';

/** What every network's station looks like, as far as a search reads it. */
export interface SearchableStation {
  id: string;
  street?: string;
  lines?: string[];
  coordinates?: string[];
}

const point = (coordinates?: string[]): [number, number] | undefined => {
  const [lon, lat] = (coordinates ?? []).map(Number);
  return Number.isFinite(lon) && Number.isFinite(lat) && lon !== 0
    ? [lon, lat]
    : undefined;
};

/**
 * One network's stations as search hits.
 *
 * A stop is found by its name, by its number — the one on the pole, which is
 * what a reader who uses the stop every day types — and by its lines. A number
 * typed exactly wins outright: "720" is the stop 720 before it is anything
 * with 720 in its name.
 */
export const searchStations = (
  stations: SearchableStation[],
  query: string,
  type: SearchHitType,
  describe: (station: SearchableStation) => string | undefined,
): SearchHit[] => {
  const trimmed = query.trim();
  return stations.map((station) => {
    let score = matchScore(query, [
      { text: station.street, weight: 3 },
      { text: station.id, weight: 2 },
      { text: station.lines?.join(' '), weight: 1 },
    ]);
    if (station.id === trimmed) score += 50;
    return {
      type,
      id: station.id,
      title: station.street || station.id,
      subtitle: describe(station),
      coordinates: point(station.coordinates),
      service: 'zaragoza',
      score,
    };
  });
};
