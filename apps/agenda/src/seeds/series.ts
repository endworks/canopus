import { DateRule, Precision } from '../model/rules';
import { Link, Text } from '../model/types';

/**
 * The series this version knows, and the editions of them it holds.
 *
 * Written here until the editorial store exists (docs/agenda/content.md). They
 * are editorial data, source `editorial`, and keyed the way editorial data is:
 * a `key` that is permanent once published, mapped to an id in `identities`.
 * Moving them into the store later changes where they are written, not their
 * ids.
 *
 * Every rule is checked against the editions research.md confirms, in
 * `series.spec.ts`. A rule that stops fitting fails that test, not a reader.
 */
export interface SeriesSeed {
  key: string;
  name: Text;
  summary?: Text;
  kinds: string[];
  links: Link[];
  pattern: 'yearly' | 'seasonal' | 'irregular';
  usualMonths: number[];
  rule?: DateRule;
  precision: Precision;
  /** Editions whose dates a source confirmed: what the rule is tested on. */
  known: { year: number; startDate: string; endDate: string }[];
}

export interface EditionSeed {
  key: string;
  series: string;
  title: Text;
  officialSpan: { startDate: string; endDate: string };
  status: 'announced' | 'programme-partial' | 'programme-complete' | 'over';
  guests?: Text[];
  links: Link[];
  /** The city's programme titles and portal titles whose events belong here. */
  linkCity: { programmes: string[]; portals: string[] };
  /** Where these facts were checked. */
  verified: { url: string; at: string };
}

const monday = (month: number, day: number) => ({
  weekday: 1,
  onOrBefore: { fixed: { month, day } },
});

export const SERIES: SeriesSeed[] = [
  {
    key: 'fiestas-del-pilar',
    name: { es: 'Fiestas del Pilar', en: 'Fiestas del Pilar' },
    kinds: ['festivity'],
    links: [
      {
        kind: 'official',
        url: 'https://www.zaragoza.es/sede/portal/cultura/fiestas-pilar/',
      },
    ],
    pattern: 'yearly',
    usualMonths: [10],
    // The week of 12 October, from the Saturday before it, and Monday the 13th
    // too when the 12th is a Sunday: the holiday moves to the Monday.
    rule: {
      start: { offset: -2, of: monday(10, 12) },
      end: {
        ifWeekday: { of: { fixed: { month: 10, day: 12 } }, is: [7] },
        then: { fixed: { month: 10, day: 13 } },
        else: { offset: 6, of: monday(10, 12) },
      },
    },
    precision: 'day',
    known: [
      { year: 2024, startDate: '2024-10-05', endDate: '2024-10-13' },
      { year: 2025, startDate: '2025-10-04', endDate: '2025-10-13' },
      { year: 2026, startDate: '2026-10-10', endDate: '2026-10-18' },
    ],
  },
  {
    key: 'navidad',
    name: { es: 'Navidad', en: 'Christmas' },
    kinds: ['festivity'],
    links: [
      {
        kind: 'official',
        url: 'https://www.zaragoza.es/sede/portal/cultura/navidad/',
      },
    ],
    pattern: 'yearly',
    usualMonths: [11, 12, 1],
    // From the last weekend of November, when the lights go on (Friday or
    // Saturday: hence `weekend`), to Reyes.
    rule: {
      start: { last: { weekday: 5, month: 11 } },
      end: { fixed: { month: 1, day: 6 }, yearOffset: 1 },
    },
    precision: 'weekend',
    known: [
      { year: 2024, startDate: '2024-11-29', endDate: '2025-01-06' },
      { year: 2025, startDate: '2025-11-28', endDate: '2026-01-06' },
      { year: 2026, startDate: '2026-11-27', endDate: '2027-01-06' },
    ],
  },
  {
    key: 'semana-santa',
    name: { es: 'Semana Santa', en: 'Holy Week' },
    kinds: ['religious', 'tradition'],
    links: [],
    pattern: 'yearly',
    usualMonths: [3, 4],
    rule: { start: { easter: -7 }, end: { easter: 0 } },
    precision: 'day',
    known: [{ year: 2026, startDate: '2026-03-29', endDate: '2026-04-05' }],
  },
  {
    key: 'halloween',
    name: { es: 'Halloween', en: 'Halloween' },
    kinds: ['festivity'],
    links: [],
    pattern: 'yearly',
    usualMonths: [10],
    rule: {
      start: { fixed: { month: 10, day: 31 } },
      end: { fixed: { month: 10, day: 31 } },
    },
    precision: 'day',
    known: [],
  },
  {
    key: 'carnaval',
    name: { es: 'Carnaval', en: 'Carnival' },
    kinds: ['festivity'],
    links: [],
    pattern: 'yearly',
    usualMonths: [2, 3],
    rule: { start: { easter: -50 }, end: { easter: -47 } },
    precision: 'weekend',
    known: [],
  },
  {
    key: 'cincomarzada',
    name: { es: 'Cincomarzada', en: 'Cincomarzada' },
    kinds: ['festivity', 'tradition'],
    links: [],
    pattern: 'yearly',
    usualMonths: [3],
    rule: {
      start: { fixed: { month: 3, day: 5 } },
      end: { fixed: { month: 3, day: 5 } },
    },
    precision: 'day',
    known: [],
  },
  {
    key: 'san-valero',
    name: { es: 'San Valero', en: 'San Valero' },
    kinds: ['festivity', 'tradition'],
    links: [],
    pattern: 'yearly',
    usualMonths: [1],
    rule: {
      start: { fixed: { month: 1, day: 29 } },
      end: { fixed: { month: 1, day: 29 } },
    },
    precision: 'day',
    known: [],
  },
  {
    key: 'san-jorge',
    name: { es: 'San Jorge, Día de Aragón', en: 'Saint George, Aragon Day' },
    kinds: ['festivity'],
    links: [],
    pattern: 'yearly',
    usualMonths: [4],
    rule: {
      start: { fixed: { month: 4, day: 23 } },
      end: { fixed: { month: 4, day: 23 } },
    },
    precision: 'day',
    known: [],
  },
  {
    key: 'champions-burger',
    name: { es: 'The Champions Burger', en: 'The Champions Burger' },
    kinds: ['food', 'festival'],
    links: [],
    pattern: 'irregular',
    // The tour sets its own dates each year: 3–20 April 2025, 18 March–5 April
    // 2026, both at the Expo. Months, and no countdown.
    usualMonths: [3, 4],
    precision: 'season',
    known: [
      { year: 2025, startDate: '2025-04-03', endDate: '2025-04-20' },
      { year: 2026, startDate: '2026-03-18', endDate: '2026-04-05' },
    ],
  },
];

export const EDITIONS: EditionSeed[] = [
  {
    key: 'navidad-2026',
    series: 'navidad',
    title: { es: 'Navidad 2026', en: 'Christmas 2026' },
    officialSpan: { startDate: '2026-11-27', endDate: '2027-01-06' },
    status: 'programme-partial',
    links: [
      {
        kind: 'official',
        url: 'https://www.zaragoza.es/sede/portal/cultura/navidad/',
      },
    ],
    linkCity: { programmes: ['Navidad'], portals: ['Navidad'] },
    verified: {
      url: 'https://www.zaragoza.es/sede/portal/cultura/navidad/',
      at: '2026-11-23',
    },
  },
  {
    key: 'fiestas-del-pilar-2026',
    series: 'fiestas-del-pilar',
    title: { es: 'Fiestas del Pilar 2026', en: 'Fiestas del Pilar 2026' },
    officialSpan: { startDate: '2026-10-10', endDate: '2026-10-18' },
    status: 'over',
    guests: [
      { es: 'Venezuela, país invitado', en: 'Venezuela, guest country' },
    ],
    links: [
      {
        kind: 'official',
        url: 'https://www.zaragoza.es/sede/portal/cultura/fiestas-pilar/',
      },
    ],
    linkCity: {
      programmes: ['Fiestas del Pilar 2026'],
      portals: ['Fiestas del Pilar'],
    },
    verified: {
      url: 'https://www.zaragoza.es/sede/portal/cultura/fiestas-pilar/',
      at: '2026-11-23',
    },
  },
];
