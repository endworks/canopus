import { foldText } from '@canopus/shared';
import {
  addDays,
  eachDate,
  fromLocal,
  localDate,
  weekday,
} from '../model/time';
import {
  OccurrenceKind,
  Offer,
  Pricing,
  Text,
  Visibility,
} from '../model/types';
import {
  CityEvent,
  CityFacility,
  CityLocation,
  CitySubEvent,
} from './city-record';

/**
 * The city's records in the agenda's shapes, without ids.
 *
 * Pure: a record in, candidates out. Ids, identities and what is already in
 * the database are the publisher's business. That keeps every rule here
 * testable with a record from `raw_records` and nothing else.
 */

export const SOURCE = 'city.agenda';
export const FACILITIES_SOURCE = 'city.facilities';

/** Zaragoza's municipal term and a margin: Muel and Borja are outside it. */
const BOUNDS = { west: -1.15, east: -0.65, south: 41.5, north: 41.8 };

export const inCity = ([lon, lat]: [number, number]): boolean =>
  lon >= BOUNDS.west &&
  lon <= BOUNDS.east &&
  lat >= BOUNDS.south &&
  lat <= BOUNDS.north;

export interface PlaceCandidate {
  ref: string;
  source: string;
  name: string;
  kinds: string[];
  type: 'venue' | 'area';
  coordinates?: [number, number];
  street?: string;
  postalCode?: string;
  district?: string;
  phone?: string;
  email?: string;
  website?: string;
  hoursText?: string;
  admissionText?: string;
}

export interface OccurrenceCandidate {
  /** Stable while the session is the same session: see `sourceKey` in the data model. */
  sourceKey: string;
  placeRef?: string;
  kind: OccurrenceKind;
  starts: Date;
  ends?: Date;
  precision: 'exact' | 'day' | 'approximate' | 'tbc';
  every?: number;
  localDate: string;
  localTime?: string;
  localEndDate?: string;
  localEndTime?: string;
  hours?: { days: number[]; opens: string; closes?: string }[];
}

export interface EventCandidate {
  ref: string;
  title: string;
  description?: string;
  kinds: string[];
  categoryAsPublished?: string;
  tags: string[];
  audience: {
    kind: string;
    minAge?: number;
    maxAge?: number;
    restricted?: Text;
  };
  visibility: Visibility;
  visibilityRule: string;
  offers: Omit<Offer, 'provenance'>[];
  pricing: Pricing;
  links: { kind: string; url: string }[];
  image?: string;
  where?: string;
  programmes: string[];
  portals: string[];
  places: PlaceCandidate[];
  occurrences: OccurrenceCandidate[];
  startDate: string;
  endDate: string;
}

const DAYS: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

/** The named entities the city's editors use; anything else becomes a space. */
const ENTITIES: Record<string, string> = {
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  ccedil: 'ç',
  agrave: 'à',
  egrave: 'è',
  ograve: 'ò',
  iquest: '¿',
  iexcl: '¡',
  ordm: 'º',
  ordf: 'ª',
  euro: '€',
  deg: '°',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  bull: '•',
};

/** HTML to the plain paragraphs the data model stores. No tag survives. */
export const htmlToText = (html?: string): string | undefined => {
  if (!html) return undefined;
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name] ?? match)
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(+code))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, i, all) => line || (i > 0 && all[i - 1]))
    .join('\n')
    .trim();
  return text || undefined;
};

/** The city writes titles in capitals often enough to be worth undoing. */
export const tidyTitle = (title?: string): string => {
  const trimmed = (title ?? '').replace(/\s+/g, ' ').trim();
  const letters = trimmed.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 4 && letters === letters.toUpperCase()) {
    const lower = trimmed.toLocaleLowerCase('es');
    return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
  }
  return trimmed;
};

const CATEGORY_KINDS: Record<string, string> = {
  musica: 'music',
  'teatro y artes escenicas': 'stage',
  deporte: 'sport',
  'artes plasticas': 'exhibition',
  exposiciones: 'exhibition',
  cine: 'film',
  'imagen y sonido': 'film',
  'ferias y fiestas': 'festivity',
  'ocio y juegos': 'leisure',
  'ciencia y tecnologia': 'talk',
  'conferencias y congresos': 'talk',
  gastronomia: 'food',
  'medio ambiente y naturaleza': 'outdoors',
  'aire libre y excursiones': 'outdoors',
  'visitas turisticas': 'tour',
  turismo: 'tour',
  formacion: 'course',
  'cursos y talleres': 'course',
  idiomas: 'course',
  'desarrollo personal': 'course',
  'empleo y empresa': 'course',
  'actividades vacacionales': 'family',
};

const TYPE_KINDS: Record<string, string> = {
  exposiciones: 'exhibition',
  fiestas: 'festivity',
  festivales: 'festival',
  ferias: 'market',
  concierto: 'music.concert',
  'visitas guiadas': 'tour',
  'excursiones y viajes': 'outdoors',
  'charlas conferencias y otros': 'talk',
  'congresos y jornadas': 'talk',
  'cursos y talleres': 'course',
};

/** For the city's "Otras": what the title or the place gives away. */
const TITLE_KINDS: [RegExp, string][] = [
  [
    /\b(concierto|orquesta|coro|banda|gospel|jazz|rock|flamenco|recital)\b/,
    'music',
  ],
  [
    /\b(teatro|musical|comedia|monologo|titeres|cuentacuentos|cuentos)\b/,
    'stage',
  ],
  [/\b(magia|mago|circo)\b/, 'circus'],
  [/\b(danza|ballet|baile)\b/, 'dance'],
  [/\b(exposicion|muestra)\b/, 'exhibition'],
  [/\b(cine|pelicula|proyeccion|corto)\b/, 'film'],
  [/\b(mercado|mercadillo|feria)\b/, 'market'],
  [/\b(carrera|torneo|trofeo|partido|maraton)\b/, 'sport'],
  [/\b(belen|misa|procesion|rosario|ofrenda)\b/, 'religious'],
  [/\b(visita|ruta)\b/, 'tour'],
  [/\b(taller|curso)\b/, 'course'],
  [/\b(jota|gigantes|cabezudos|comparsa)\b/, 'tradition'],
];

const COURSE_TYPES = new Set([
  'cursos y talleres',
  'reunion',
  'campamentos y colonias',
]);
const LONG_RUN_OK = new Set(['exhibition', 'market', 'festival', 'festivity']);
const RESTRICTED = new Set([
  'personas mayores',
  'mujeres',
  'hombres',
  'inmigrantes',
  'personas con discapacidad',
]);

export const kindsFor = (
  record: CityEvent,
): { kinds: string[]; label?: string } => {
  const categories = (record.category ?? [])
    .map((c) => c.title)
    .filter(Boolean);
  const kinds = new Set<string>();
  const type = foldText(record.type ?? '');
  if (TYPE_KINDS[type]) kinds.add(TYPE_KINDS[type]);
  for (const category of categories) {
    const kind = CATEGORY_KINDS[foldText(category)];
    if (kind) kinds.add(kind);
  }
  if (kinds.size === 0) {
    const haystack = foldText(`${record.title ?? ''}`);
    for (const [pattern, kind] of TITLE_KINDS) {
      if (pattern.test(haystack)) {
        kinds.add(kind);
        break;
      }
    }
  }
  const children = (record.population ?? []).some(
    (p) => foldText(p.title ?? '') === 'infancia',
  );
  if (children) kinds.add('family');
  if (kinds.size === 0) kinds.add('other');
  return { kinds: [...kinds], label: categories[0] ?? record.type };
};

const placeKinds = (
  name: string,
): { kinds: string[]; type: 'venue' | 'area' } => {
  const n = foldText(name);
  if (/^(museo|museum)|\bmuseo\b/.test(n))
    return { kinds: ['venue.museum'], type: 'venue' };
  if (/\bteatro\b/.test(n)) return { kinds: ['venue.theatre'], type: 'venue' };
  if (/\bauditorio\b|\bsala mozart\b/.test(n))
    return { kinds: ['venue.concert-hall'], type: 'venue' };
  if (/\bfilmoteca\b|\bcine\b/.test(n))
    return { kinds: ['venue.cinema'], type: 'venue' };
  if (/\bbiblioteca\b/.test(n))
    return { kinds: ['venue.library'], type: 'venue' };
  if (/\bcentro civico\b|^c c\b|\bcentro de convivencia\b/.test(n))
    return { kinds: ['venue.civic-centre'], type: 'venue' };
  if (/\b(iglesia|parroquia|basilica|catedral)\b/.test(n))
    return { kinds: ['venue.church'], type: 'venue' };
  if (/\b(pabellon|polideportivo|estadio|campo de futbol)\b/.test(n))
    return { kinds: ['venue.sports'], type: 'venue' };
  if (/^plaza\b|^pza\b/.test(n))
    return { kinds: ['area.square'], type: 'area' };
  if (/^parque\b/.test(n)) return { kinds: ['area.park'], type: 'area' };
  if (/\brecinto ferial\b/.test(n))
    return { kinds: ['area.fairground'], type: 'area' };
  return { kinds: ['venue'], type: 'venue' };
};

export const placeFrom = (
  location?: CityLocation,
): PlaceCandidate | undefined => {
  if (!location?.id || !location.title) return undefined;
  const name = location.title.replace(/\s+/g, ' ').trim();
  if (foldText(name) === 'lugar por determinar') return undefined;
  const coordinates = location.geometry?.coordinates;
  return {
    ref: String(location.id),
    source: SOURCE,
    name,
    ...placeKinds(name),
    coordinates:
      coordinates && coordinates.length === 2
        ? [coordinates[0], coordinates[1]]
        : undefined,
    street: location.streetAddress?.trim() || undefined,
    postalCode: location.postalCode?.trim() || undefined,
    district:
      location.junta?.replace(/^Junta (Municipal|Vecinal) /, '').trim() ||
      undefined,
    phone: location.telephone?.trim() || undefined,
    email: location.email?.trim() || undefined,
  };
};

export const facilityPlace = (
  facility: CityFacility,
): PlaceCandidate | undefined => {
  if (!facility.title) return undefined;
  const coordinates = facility.geometry?.coordinates;
  return {
    ref: String(facility.id),
    source: FACILITIES_SOURCE,
    name: facility.title.trim(),
    kinds: ['venue.museum'],
    type: 'venue',
    coordinates:
      coordinates && coordinates.length === 2
        ? [coordinates[0], coordinates[1]]
        : undefined,
    street: facility.calle?.trim() || undefined,
    postalCode: facility.postalCode?.trim() || undefined,
    district:
      facility.junta?.replace(/^Junta (Municipal|Vecinal) /, '').trim() ||
      undefined,
    phone: facility.tel?.tel?.trim() || undefined,
    email: facility.email?.trim() || undefined,
    website: facility.url?.trim() || undefined,
    hoursText: htmlToText(facility.horario),
    admissionText: htmlToText(facility.precio),
  };
};

const pricesFrom = (
  record: CityEvent,
): { offers: Omit<Offer, 'provenance'>[]; pricing: Pricing } => {
  // Keyed by the tier's name and sorted: the city sends the same tiers in a
  // different order from one fetch to the next.
  const byId = new Map<string, Omit<Offer, 'provenance'>>();
  for (const price of record.price ?? []) {
    const group = foldText(price.fareGroup ?? '');
    if (group.startsWith('gratuit')) {
      byId.set('free', {
        id: 'free',
        free: true,
        currency: 'EUR',
        availability: 'unknown',
      });
    } else if (price.hasCurrencyValue && price.hasCurrencyValue > 0) {
      const id = `${group.replace(/ /g, '-') || 'general'}-${price.hasCurrencyValue}`;
      byId.set(id, {
        id,
        name: price.fareGroup ? { es: price.fareGroup } : undefined,
        price: price.hasCurrencyValue,
        currency: 'EUR',
        availability: 'unknown',
      });
    }
  }
  const offers = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const comment = htmlToText(record.priceComment);
  if (comment && offers.length === 1) offers[0].conditions = { es: comment };
  const free = offers.filter((o) => o.free).length;
  const pricing: Pricing =
    offers.length === 0
      ? 'unknown'
      : free === offers.length
        ? 'free'
        : free === 0
          ? 'paid'
          : 'mixed';
  return { offers, pricing };
};

const date = (value?: string) => (value ? value.slice(0, 10) : undefined);
const hhmm = (value?: string) =>
  value && /^\d{1,2}:\d{2}/.test(value)
    ? value.slice(0, 5).padStart(5, '0')
    : undefined;

/** How far ahead weekly patterns are expanded. Re-runs extend it day by day. */
export const HORIZON_DAYS = 120;
/** How far back: sessions earlier than this were made by earlier runs and are kept. */
export const LOOKBACK_DAYS = 7;
/** A run longer than this with weekly hours is drawn as a run, not as sessions. */
const RUN_DAYS = 14;

export const occurrencesFor = (
  sub: CitySubEvent,
  placeRef: string | undefined,
  kinds: string[],
  today: string,
): OccurrenceCandidate[] => {
  const start = date(sub.startDate);
  const end = date(sub.endDate) ?? start;
  if (!start || !end) return [];
  const hours = (sub.openingHours ?? [])
    .map((h) => ({
      day: DAYS[foldText(h.dayOfWeek ?? '')],
      opens: hhmm(h.startTime),
      closes: hhmm(h.endTime),
    }))
    .filter((h) => h.day && h.opens);
  const span = eachDate(start, end).length;
  const key = (suffix: string) => `${placeRef ?? '-'}|${suffix}`;

  // An exhibition, a market, a fair: one run across its days, with its hours.
  const longRun =
    span > RUN_DAYS && kinds.some((k) => LONG_RUN_OK.has(k.split('.')[0]));
  if (hours.length === 0 || longRun) {
    const grouped = new Map<string, number[]>();
    for (const h of hours) {
      const slot = `${h.opens}-${h.closes ?? ''}`;
      grouped.set(slot, [...(grouped.get(slot) ?? []), h.day]);
    }
    return [
      {
        sourceKey: key(`run:${start}:${end}`),
        placeRef,
        kind: start === end ? 'session' : 'run',
        starts: fromLocal(start),
        ends: fromLocal(addDays(end, 1)),
        precision: 'day',
        localDate: start,
        localEndDate: end,
        hours: [...grouped]
          .map(([slot, days]) => {
            const [opens, closes] = slot.split('-');
            // Left out rather than undefined: stored, undefined becomes null and
            // would never compare equal again.
            return closes
              ? { days: days.sort(), opens, closes }
              : { days: days.sort(), opens };
          })
          // The city sends the same hours in a different order on every fetch.
          .sort(
            (a, b) => a.days[0] - b.days[0] || a.opens.localeCompare(b.opens),
          ),
      },
    ];
  }

  const from =
    start > addDays(today, -LOOKBACK_DAYS)
      ? start
      : addDays(today, -LOOKBACK_DAYS);
  const to =
    end < addDays(today, HORIZON_DAYS) ? end : addDays(today, HORIZON_DAYS);
  const out: OccurrenceCandidate[] = [];
  for (const day of from <= to ? eachDate(from, to) : []) {
    for (const h of hours.filter((h) => h.day === weekday(day))) {
      const starts = fromLocal(day, h.opens);
      let ends = h.closes ? fromLocal(day, h.closes) : undefined;
      if (ends && ends <= starts) ends = fromLocal(addDays(day, 1), h.closes);
      out.push({
        sourceKey: key(`${day}T${h.opens}`),
        placeRef,
        kind: 'session',
        starts,
        ends,
        precision: 'exact',
        localDate: day,
        localTime: h.opens,
        localEndDate: ends ? localDate(ends) : undefined,
        localEndTime: h.closes,
      });
    }
  }
  return out;
};

export interface VisibilityResult {
  visibility: Visibility;
  rule: string;
}

export const visibilityFor = (
  record: CityEvent,
  kinds: string[],
  places: PlaceCandidate[],
  today: string,
): VisibilityResult => {
  const end = date(record.endDate);
  if (end && end < today)
    return { visibility: 'hidden', rule: 'ended-before-import' };
  const located = places.filter((p) => p.coordinates);
  if (places.length === 0) return { visibility: 'hidden', rule: 'no-place' };
  if (located.length > 0 && !located.some((p) => inCity(p.coordinates))) {
    return { visibility: 'hidden', rule: 'outside-city' };
  }
  if (
    COURSE_TYPES.has(foldText(record.type ?? '')) ||
    kinds.includes('course')
  ) {
    return { visibility: 'searchable', rule: 'course' };
  }
  const populations = (record.population ?? []).map((p) =>
    foldText(p.title ?? ''),
  );
  if (populations.length > 0 && populations.every((p) => RESTRICTED.has(p))) {
    return { visibility: 'searchable', rule: 'restricted-audience' };
  }
  const start = date(record.startDate);
  if (
    start &&
    end &&
    eachDate(start, end).length > RUN_DAYS &&
    !kinds.some((k) => LONG_RUN_OK.has(k.split('.')[0]))
  ) {
    return { visibility: 'searchable', rule: 'long-recurring' };
  }
  return { visibility: 'listed', rule: 'default' };
};

const age = (value?: number | string) => {
  const n = typeof value === 'string' ? parseInt(value, 10) : value;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const absolute = (url?: string) =>
  !url
    ? undefined
    : url.startsWith('//')
      ? `https:${url}`
      : url.startsWith('http')
        ? url
        : undefined;

export const normaliseEvent = (
  record: CityEvent,
  today: string,
): EventCandidate | undefined => {
  const startDate = date(record.startDate);
  const endDate = date(record.endDate) ?? startDate;
  if (!record.id || !record.title || !startDate) return undefined;

  const { kinds, label } = kindsFor(record);
  const places: PlaceCandidate[] = [];
  const occurrences: OccurrenceCandidate[] = [];
  for (const sub of record.subEvent ?? []) {
    const place = placeFrom(sub.location);
    if (place && !places.some((p) => p.ref === place.ref)) places.push(place);
    occurrences.push(...occurrencesFor(sub, place?.ref, kinds, today));
  }
  if (occurrences.length === 0) {
    occurrences.push(
      ...occurrencesFor(
        { startDate: record.startDate, endDate: record.endDate },
        places[0]?.ref,
        kinds,
        today,
      ),
    );
  }

  const populations = (record.population ?? []).map((p) => p.title ?? '');
  const folded = populations.map(foldText);
  const restricted = populations.filter((_p, i) => RESTRICTED.has(folded[i]));
  const audience = {
    kind: folded.includes('infancia')
      ? 'children'
      : folded.includes('jovenes')
        ? 'youth'
        : restricted.length > 0 && restricted.length === populations.length
          ? 'adults'
          : 'all',
    minAge: age(record.minAge),
    maxAge: age(record.maxAge),
    restricted:
      restricted.length > 0 && restricted.length === populations.length
        ? { es: restricted.join(', ') }
        : undefined,
  };

  const { visibility, rule } = visibilityFor(record, kinds, places, today);
  const { offers, pricing } = pricesFrom(record);
  const links: { kind: string; url: string }[] = [];
  const official = absolute(record.url);
  if (official) links.push({ kind: 'official', url: official });
  links.push({
    kind: 'source',
    url: `https://www.zaragoza.es/sede/servicio/cultura/evento/${record.id}`,
  });
  const registration = absolute(record.registration?.url);
  if (registration) links.push({ kind: 'tickets', url: registration });

  return {
    ref: String(record.id),
    title: tidyTitle(record.title),
    description: htmlToText(record.description),
    kinds,
    categoryAsPublished: label,
    tags: [record.program?.title, record.performer].filter(Boolean) as string[],
    audience,
    visibility,
    visibilityRule: rule,
    offers,
    pricing,
    links,
    image: absolute(record.image),
    where:
      places.length === 0 ? record.location?.trim() || undefined : undefined,
    programmes: record.program?.title ? [record.program.title] : [],
    portals: (record.portales ?? [])
      .map((p) => p.portal?.title)
      .filter(Boolean) as string[],
    places,
    occurrences,
    startDate,
    endDate,
  };
};

export const todayInCity = (now = new Date()) => localDate(now);
