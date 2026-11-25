import { matchScore, SearchHit, SearchHitType } from '@canopus/shared';

/** What every network's station looks like, as far as a search reads it. */
export interface SearchableStation {
  id: string;
  street?: string;
  lines?: string[];
  coordinates?: string[];
}

/** What every network's line looks like, as far as a search reads it. */
export interface SearchableLine {
  id: string;
  name?: string;
  hidden?: boolean;
}

const point = (coordinates?: string[]): [number, number] | undefined => {
  const [lon, lat] = (coordinates ?? []).map(Number);
  return Number.isFinite(lon) && Number.isFinite(lat) && lon !== 0
    ? [lon, lat]
    : undefined;
};

/**
 * What a code typed whole is worth, on top of its match: enough to win
 * outright, and stepped so that a bare number shared by several networks
 * reads as a line, then a bus stop, then a tram stop, then a dock.
 */
export const EXACT_CODE: Partial<Record<SearchHitType, number>> = {
  'bus-line': 60,
  'tram-line': 58,
  'bus-stop': 50,
  'tram-stop': 45,
  'bizi-station': 40,
};

const fold = (code: string) => code.trim().toLowerCase();

/**
 * One network's stations as search hits.
 *
 * A stop is found by its name, by its number — the one on the pole, which is
 * what a reader who uses the stop every day types — and by its lines. A number
 * typed whole wins outright: "720" is the stop 720 before it is anything with
 * 720 in its name. `codes` says which numbers a stop answers to, where that is
 * not its id: a tram stop is stored under its place and signed with its
 * platforms.
 */
export const searchStations = (
  stations: SearchableStation[],
  query: string,
  type: SearchHitType,
  describe: (station: SearchableStation) => string | undefined,
  codes: (station: SearchableStation) => string[] = (station) => [station.id],
): SearchHit[] => {
  const typed = fold(query);
  return stations.map((station) => {
    const signed = codes(station);
    let score = matchScore(query, [
      { text: station.street, weight: 3 },
      { text: signed.join(' '), weight: 2, identifier: true },
      { text: station.lines?.join(' '), weight: 1, identifier: true },
    ]);
    if (signed.some((code) => fold(code) === typed))
      score += EXACT_CODE[type] ?? 0;
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

/**
 * One network's lines as search hits: "35", "Ci2", "N1" or "L1" is the line,
 * and its name ("Barrio Jesús - Oliver Miralbueno") finds it too, below the
 * stops of that name.
 */
export const searchLines = (
  lines: SearchableLine[],
  query: string,
  type: 'bus-line' | 'tram-line',
  title: (line: SearchableLine) => string,
): SearchHit[] => {
  const typed = fold(query);
  return lines
    .filter((line) => !line.hidden)
    .map((line) => {
      let score = matchScore(query, [
        { text: line.id, weight: 3, identifier: true },
        { text: line.name, weight: 1 },
      ]);
      if (fold(line.id) === typed) score += EXACT_CODE[type] ?? 0;
      return {
        type,
        id: line.id,
        title: title(line),
        subtitle: line.name,
        service: 'zaragoza',
        score,
      };
    });
};
