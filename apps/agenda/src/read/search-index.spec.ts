import { describe, expect, it } from 'vitest';
import {
  groupSessions,
  kindIcon,
  searchAgenda,
  timeFactor,
} from './search-index';

const TODAY = '2026-11-25';

describe('timeFactor', () => {
  it('lifts what is on now and this week, and sinks what has ended', () => {
    const on = timeFactor(
      { startDate: '2026-11-01', endDate: '2026-12-31' },
      TODAY,
    );
    const week = timeFactor({ startDate: '2026-11-30' }, TODAY);
    const month = timeFactor({ startDate: '2026-12-20' }, TODAY);
    const later = timeFactor({ startDate: '2027-06-12' }, TODAY);
    const ended = timeFactor(
      { startDate: '2026-11-10', endDate: '2026-11-12' },
      TODAY,
    );
    expect(on).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(month);
    expect(month).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(ended);
  });
});

const event = (
  id: string,
  title: string,
  startDate: string,
  placeId = 'auditorio',
) =>
  ({
    _id: id,
    type: 'activity',
    title: { es: title },
    tags: [],
    placeIds: [placeId],
    span: { startDate, endDate: startDate },
    visibility: 'listed',
    status: 'scheduled',
  }) as any;

const index = (events: any[]) => ({
  series: [],
  events,
  places: new Map([
    [
      'auditorio',
      {
        _id: 'auditorio',
        name: { es: 'Auditorio de Zaragoza' },
        aliases: [],
      } as any,
    ],
    [
      'esquinas',
      {
        _id: 'esquinas',
        name: { es: 'Teatro de las Esquinas' },
        aliases: [],
      } as any,
    ],
  ]),
});

describe('searchAgenda', () => {
  it('puts the concert this week before the one next summer', () => {
    const hits = searchAgenda(
      index([
        event('summer', 'Concierto de David Bisbal', '2027-06-12', 'esquinas'),
        event('week', 'Concierto de Navidad', '2026-11-28'),
      ]),
      'concierto',
      () => true,
      'es',
      TODAY,
    ).sort((a, b) => b.score - a.score);
    expect(hits.map((h) => h.id)).toEqual(['week', 'summer']);
  });

  it('folds the nights of one run at one place into one hit', () => {
    const hits = searchAgenda(
      index([
        event('a', 'Concierto de Navidad.', '2026-12-21'),
        event('b', 'Concierto de Navidad.', '2026-12-15'),
        event('c', 'Concierto de Navidad', '2026-12-23', 'esquinas'),
      ]),
      'concierto navidad',
      (t) => t === 'activity',
      'es',
      TODAY,
    );
    const auditorio = hits.find((h) => h.subtitle === 'Auditorio de Zaragoza');
    expect(hits).toHaveLength(2);
    expect(auditorio?.id).toBe('b');
    expect(auditorio?.more).toBe(1);
  });

  it('finds a venue by a slip in its name', () => {
    const hits = searchAgenda(
      index([]),
      'auditorip',
      (t) => t === 'venue',
      'es',
      TODAY,
    );
    expect(hits.map((h) => h.id)).toEqual(['auditorio']);
  });

  it('leaves alone hits that are not sessions', () => {
    const hits = groupSessions(
      [
        { type: 'venue', id: 'x', title: 'Same', service: 'agenda', score: 1 },
        { type: 'venue', id: 'y', title: 'Same', service: 'agenda', score: 1 },
      ],
      () => undefined,
    );
    expect(hits).toHaveLength(2);
  });
});

describe('kindIcon', () => {
  it('reads a kind, or its nearest parent, as its glyph', () => {
    expect(kindIcon(['music.concert'])).toBe('microphone-stage');
    expect(kindIcon(['music.concert.unheard-of'])).toBe('microphone-stage');
    expect(kindIcon(['unheard-of'])).toBeUndefined();
    expect(kindIcon(undefined)).toBeUndefined();
  });
});
