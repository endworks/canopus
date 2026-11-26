import { HttpException } from '@nestjs/common';
import { daysBetween, toLocalIso } from '../model/time';
import {
  EventDoc,
  OccurrenceDoc,
  PlaceDoc,
  SeriesDoc,
  Text,
} from '../model/types';

/**
 * The documents as docs/agenda/api.md writes them: summaries for lists and
 * `included`, details for an entity's own route, text resolved to one language.
 */

export type Lang = 'es' | 'en';

export const lang = (value?: string): Lang => (value === 'en' ? 'en' : 'es');

/** The text in the language asked for, else the one it exists in. */
export const say = (text: Text | undefined, l: Lang): string | undefined =>
  text ? (text[l] ?? text.es ?? text.en) : undefined;

const textLang = (text: Text | undefined, l: Lang) =>
  text && !text[l] ? (text.es ? 'es' : 'en') : undefined;

/** An error in the envelope's shape, with the status the gateway answers with. */
export const apiError = (
  status: number,
  code: string,
  message: string,
  extra?: object,
) =>
  new HttpException(
    { statusCode: status, error: { code, message, ...extra } },
    status,
  );

export interface Envelope<T> {
  data: T;
  included: {
    events?: Record<string, unknown>;
    places?: Record<string, unknown>;
    series?: Record<string, unknown>;
  };
  meta: {
    generatedAt: string;
    lang: Lang;
    next?: string;
    attribution: {
      source: string;
      name: string;
      licence?: string;
      url?: string;
    }[];
  };
}

const ATTRIBUTION = {
  'city.agenda': {
    source: 'city.agenda',
    name: 'Ayuntamiento de Zaragoza',
    licence: 'CC BY 4.0',
    url: 'https://www.zaragoza.es/sede/portal/datos-abiertos/',
  },
  'city.facilities': {
    source: 'city.facilities',
    name: 'Ayuntamiento de Zaragoza',
    licence: 'CC BY 4.0',
    url: 'https://www.zaragoza.es/sede/portal/datos-abiertos/',
  },
  'city.nightlife': {
    source: 'city.nightlife',
    name: 'Ayuntamiento de Zaragoza',
    licence: 'CC BY 4.0',
    url: 'https://www.zaragoza.es/sede/portal/datos-abiertos/',
  },
  'city.monuments': {
    source: 'city.monuments',
    name: 'Ayuntamiento de Zaragoza',
    licence: 'CC BY 4.0',
    url: 'https://www.zaragoza.es/sede/portal/datos-abiertos/',
  },
} as const;

export const envelope = <T>(
  data: T,
  l: Lang,
  included: Envelope<T>['included'] = {},
  sources: Iterable<string> = [],
  next?: string,
): Envelope<T> => {
  const seen = new Set<string>();
  const attribution = [];
  for (const source of sources) {
    const entry = ATTRIBUTION[source as keyof typeof ATTRIBUTION];
    if (entry && !seen.has(entry.name)) {
      seen.add(entry.name);
      attribution.push(entry);
    }
  }
  return {
    data,
    included,
    meta: { generatedAt: toLocalIso(new Date()), lang: l, next, attribution },
  };
};

/** The source of every facet a document carries, for the attribution. */
export const sourcesOf = (
  docs: { provenance?: Record<string, { source?: string }> }[],
) => {
  const out = new Set<string>();
  for (const doc of docs) {
    for (const facet of Object.values(doc.provenance ?? {}))
      if (facet?.source) out.add(facet.source);
  }
  return out;
};

const span = (s: EventDoc['span']) =>
  s && {
    starts: toLocalIso(new Date(s.starts)),
    ends: toLocalIso(new Date(s.ends)),
    startDate: s.startDate,
    endDate: s.endDate,
  };

const weakest = (doc: EventDoc) => {
  const order = ['inferred', 'reported', 'official', 'verified'];
  const facets = ['schedule', 'place', 'pricing']
    .map((f) => doc.provenance?.[f as keyof EventDoc['provenance']])
    .filter(Boolean);
  if (facets.length === 0) return undefined;
  const level = facets.reduce((min, f) =>
    order.indexOf(f.confidence) < order.indexOf(min.confidence) ? f : min,
  );
  const checked = facets
    .map((f) => new Date(f.verifiedAt ?? f.observedAt))
    .sort((a, b) => +a - +b)[0];
  return { level: level.confidence, checkedAt: toLocalIso(checked) };
};

const priceFrom = (doc: EventDoc) => {
  const prices = doc.offers
    .map((o) => o.price ?? o.minPrice)
    .filter((p): p is number => typeof p === 'number');
  return prices.length
    ? { amount: Math.min(...prices), currency: 'EUR' }
    : undefined;
};

export const eventSummary = (doc: EventDoc, l: Lang) => {
  const title = say(doc.title, l);
  return {
    id: doc._id,
    slug: doc.slug,
    type: doc.type,
    parentId: doc.parentId,
    editionId: doc.type === 'edition' ? undefined : doc.ancestorIds?.[0],
    seriesId: doc.seriesId,
    title,
    subtitle: say(doc.subtitle, l),
    summary: say(doc.summary, l),
    textLang: textLang(doc.title, l),
    kinds: doc.kinds,
    audience: doc.audience,
    placeIds: doc.placeIds,
    where: say(doc.where, l),
    span: span(doc.span),
    officialSpan: doc.officialSpan,
    pricing: doc.pricing,
    priceFrom: priceFrom(doc),
    image: doc.media?.[0]
      ? { url: doc.media[0].url, credit: doc.media[0].credit }
      : undefined,
    status: doc.status,
    visibility: doc.visibility === 'listed' ? undefined : doc.visibility,
    reliability: weakest(doc),
  };
};

export const eventDetail = (doc: EventDoc, l: Lang) => ({
  ...eventSummary(doc, l),
  description: say(doc.description, l),
  categoryAsPublished: doc.categoryAsPublished,
  tags: doc.tags,
  offers: doc.offers.map((o) => ({
    id: o.id,
    name: say(o.name, l),
    free: o.free,
    price:
      o.price !== undefined
        ? { amount: o.price, currency: o.currency }
        : undefined,
    minPrice:
      o.minPrice !== undefined
        ? { amount: o.minPrice, currency: o.currency }
        : undefined,
    maxPrice:
      o.maxPrice !== undefined
        ? { amount: o.maxPrice, currency: o.currency }
        : undefined,
    conditions: say(o.conditions, l),
    url: o.url,
    availability: o.availability,
    checkedAt: o.provenance
      ? toLocalIso(new Date(o.provenance.observedAt))
      : undefined,
    source: o.provenance?.source,
  })),
  links: doc.links,
  media: doc.media,
  changes: (doc.changes ?? []).map((c) => ({
    at: toLocalIso(new Date(c.at)),
    facet: c.facet,
    summary: say(c.summary, l),
    occurrenceId: c.occurrenceId,
  })),
  edition: doc.edition && {
    status: doc.edition.status,
    dayStartsAt: doc.edition.dayStartsAt,
    guests: doc.edition.guests?.map((g) => say(g, l)),
  },
  sources: Object.entries(doc.provenance ?? {})
    .filter(([facet]) => facet !== 'identity')
    .reduce<
      {
        source: string;
        facets: string[];
        url?: string;
        checkedAt: string;
        confidence: string;
      }[]
    >((out, [facet, f]) => {
      const found = out.find((s) => s.source === f.source);
      if (found) found.facets.push(facet);
      else
        out.push({
          source: f.source,
          facets: [facet],
          url: f.url,
          checkedAt: toLocalIso(new Date(f.verifiedAt ?? f.observedAt)),
          confidence: f.confidence,
        });
      return out;
    }, []),
});

export const occurrenceView = (doc: OccurrenceDoc) => ({
  id: doc._id,
  eventId: doc.eventId,
  kind: doc.kind,
  starts: toLocalIso(new Date(doc.starts)),
  ends: doc.ends ? toLocalIso(new Date(doc.ends)) : undefined,
  localDate: doc.localDate,
  localTime: doc.localTime,
  localEndDate: doc.localEndDate,
  localEndTime: doc.localEndTime,
  precision: doc.precision,
  every: doc.every,
  hours: doc.hours,
  placeId: doc.placeId,
  status: doc.status,
});

export const placeSummary = (doc: PlaceDoc, l: Lang) => ({
  id: doc._id,
  slug: doc.slug,
  type: doc.type,
  kinds: doc.kinds,
  name: say(doc.name, l),
  geo: doc.geo,
  parentId: doc.parentId,
  address: doc.address,
  status: doc.status,
  image: doc.media?.[0],
  featured: doc.featured || undefined,
});

export const placeDetail = (doc: PlaceDoc, l: Lang) => ({
  ...placeSummary(doc, l),
  hours: doc.hoursText ? { note: doc.hoursText } : undefined,
  description: say(doc.description, l),
  contact: doc.contact,
  links: doc.links,
  media: doc.media,
  admission: doc.admission?.note
    ? { note: say(doc.admission.note, l) }
    : undefined,
});

export const seriesView = (doc: SeriesDoc, l: Lang) => ({
  id: doc._id,
  slug: doc.slug,
  name: say(doc.name, l),
  summary: say(doc.summary, l),
  kinds: doc.kinds,
  image: doc.media?.[0],
  recurrence: {
    pattern: doc.recurrence.pattern,
    usualMonths: doc.recurrence.usualMonths,
  },
  currentEditionId: doc.currentEditionId,
  nextExpected: doc.nextExpected,
});

const MONTH_DAY = {
  es: new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }),
  en: new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }),
};

const dayMonth = (date: string, l: Lang) =>
  MONTH_DAY[l].format(new Date(`${date}T12:00:00Z`));

/** "Hasta el 6 de enero", "Empieza en 5 días", "Terminó el 18 de octubre". */
export const highlightLabel = (
  state: 'on' | 'upcoming' | 'ended',
  startDate: string,
  endDate: string,
  today: string,
  l: Lang,
): string => {
  if (state === 'on') {
    if (endDate === today) return l === 'es' ? 'Último día' : 'Last day';
    return l === 'es'
      ? `Hasta el ${dayMonth(endDate, l)}`
      : `Until ${dayMonth(endDate, l)}`;
  }
  if (state === 'upcoming') {
    const days = daysBetween(today, startDate);
    if (days === 1) return l === 'es' ? 'Empieza mañana' : 'Starts tomorrow';
    return l === 'es' ? `Empieza en ${days} días` : `Starts in ${days} days`;
  }
  return l === 'es'
    ? `Terminó el ${dayMonth(endDate, l)}`
    : `Ended ${dayMonth(endDate, l)}`;
};
