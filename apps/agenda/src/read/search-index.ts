import {
  compareHits,
  foldText,
  matchScore,
  SearchHit,
  SearchHitType,
} from '@canopus/shared';
import { addDays } from '../model/time';
import { EventDoc, PlaceDoc, SeriesDoc } from '../model/types';
import { Lang, say } from './views';

/** What a search reads: the whole agenda, held in memory and scored there. */
export interface AgendaIndex {
  series: SeriesDoc[];
  events: EventDoc[];
  places: Map<string, PlaceDoc>;
}

/**
 * How much nearness in time lifts something that matched, so that of two
 * concerts that answer "concierto" equally the one this week comes first and
 * the one next summer last, and what has ended sinks below both.
 */
export const timeFactor = (
  span: { startDate?: string; endDate?: string } | undefined,
  today: string,
): number => {
  if (!span?.startDate) return 1;
  const end = span.endDate ?? span.startDate;
  if (end < today) return 0.4;
  if (span.startDate <= today) return 1.3;
  if (span.startDate <= addDays(today, 7)) return 1.2;
  if (span.startDate <= addDays(today, 30)) return 1;
  if (span.startDate <= addDays(today, 90)) return 0.85;
  return 0.7;
};

/**
 * Sessions of one activity at one place, as one hit.
 *
 * The city lists each night of a run as an activity of its own — "Concierto
 * de Navidad." four times at the Auditorio — and ten of those are not ten
 * answers. The best-placed one stands for them, saying how many more there are.
 */
export const groupSessions = (
  hits: SearchHit[],
  placeOf: (hit: SearchHit) => string | undefined,
): SearchHit[] => {
  const groups = new Map<string, SearchHit[]>();
  const kept: SearchHit[] = [];
  for (const hit of hits) {
    if (hit.type !== 'activity') {
      kept.push(hit);
      continue;
    }
    const key = `${foldText(hit.title)}|${placeOf(hit) ?? ''}`;
    const group = groups.get(key);
    if (group) group.push(hit);
    else groups.set(key, [hit]);
  }
  for (const group of groups.values()) {
    const [best, ...rest] = [...group].sort(compareHits);
    kept.push(rest.length ? { ...best, more: rest.length } : best);
  }
  return kept;
};

/**
 * Series, events and places matching a query, as search hits.
 *
 * Every word must meet a word of the hit (`matchScore`, which allows a
 * slip). A title counts above a venue, and nearness in time lifts what is on
 * soon (`timeFactor`).
 */
export const searchAgenda = (
  index: AgendaIndex,
  query: string,
  wants: (type: SearchHitType) => boolean,
  l: Lang,
  today: string,
): SearchHit[] => {
  const hits: SearchHit[] = [];

  if (wants('series')) {
    for (const s of index.series) {
      const score = matchScore(query, [
        { text: s.name.es, weight: 4 },
        { text: s.name.en, weight: 3 },
      ]);
      if (!score) continue;
      hits.push({
        type: 'series',
        id: s._id,
        title: say(s.name, l),
        subtitle: s.nextExpected ? `${s.nextExpected.startDate}` : undefined,
        startDate: s.nextExpected?.startDate,
        endDate: s.nextExpected?.endDate,
        service: 'agenda',
        score: score * 1.2,
      });
    }
  }

  const placeOfEvent = new Map<string, string | undefined>();
  if (wants('event') || wants('activity')) {
    for (const e of index.events) {
      const type: SearchHitType = e.type === 'activity' ? 'activity' : 'event';
      if (!wants(type)) continue;
      const place = index.places.get(e.placeIds?.[0]);
      let score = matchScore(query, [
        { text: say(e.title, l), weight: 3 },
        { text: e.tags?.join(' '), weight: 1 },
        { text: say(place?.name, l), weight: 1 },
      ]);
      if (!score) continue;
      score *= timeFactor(e.span, today);
      if (e.visibility === 'searchable') score *= 0.6;
      if (e.type === 'edition') score *= 1.3;
      placeOfEvent.set(e._id, e.placeIds?.[0]);
      hits.push({
        type,
        id: e._id,
        title: say(e.title, l),
        subtitle: say(place?.name, l),
        coordinates: place?.geo?.coordinates,
        startDate: e.span?.startDate,
        endDate: e.span?.endDate,
        service: 'agenda',
        score,
      });
    }
  }

  if (wants('venue')) {
    for (const p of index.places.values()) {
      const score = matchScore(query, [
        { text: say(p.name, l), weight: 3 },
        { text: p.aliases?.join(' '), weight: 2 },
        { text: p.address?.street, weight: 1 },
      ]);
      if (!score) continue;
      hits.push({
        type: 'venue',
        id: p._id,
        title: say(p.name, l),
        subtitle: p.address?.street,
        coordinates: p.geo?.coordinates,
        service: 'agenda',
        score,
      });
    }
  }

  return groupSessions(hits, (hit) => placeOfEvent.get(hit.id));
};
