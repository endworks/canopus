import { DateRule, Precision } from './rules';

/**
 * The published shapes, as docs/agenda/data-model.md defines them.
 *
 * Only the parts this version fills are typed here. The rest of the spec
 * (agents, participations, notices, offers from sellers) is added beside them
 * without changing these: every field below is one the spec already has.
 */

export type Text = { es?: string; en?: string };

export type Confidence = 'verified' | 'official' | 'reported' | 'inferred';

export interface FacetSource {
  source: string;
  ref?: string;
  url?: string;
  observedAt: Date;
  verifiedAt?: Date;
  confidence: Confidence;
}

export type Facet =
  | 'identity'
  | 'schedule'
  | 'place'
  | 'pricing'
  | 'booking'
  | 'text'
  | 'media'
  | 'classification';

export type Provenance = Partial<Record<Facet, FacetSource>>;

export interface Change {
  at: Date;
  facet: 'schedule' | 'place' | 'status' | 'pricing';
  summary: Text;
  occurrenceId?: string;
}

export interface MediaRef {
  url: string;
  width?: number;
  height?: number;
  alt?: Text;
  credit?: string;
}

export interface Link {
  kind: string;
  url: string;
  label?: Text;
}

export interface Offer {
  id: string;
  name?: Text;
  free?: true;
  price?: number;
  minPrice?: number;
  maxPrice?: number;
  currency: 'EUR';
  conditions?: Text;
  url?: string;
  availability: string;
  provenance: FacetSource;
}

export type Pricing = 'free' | 'paid' | 'mixed' | 'unknown';

export type Visibility = 'listed' | 'searchable' | 'hidden';

export type EventType = 'edition' | 'programme' | 'activity';

export type EventStatus =
  'scheduled' | 'changed' | 'postponed' | 'cancelled' | 'removed';

export interface EventDoc {
  _id: string;
  slug: string;
  slugHistory: string[];
  type: EventType;
  seriesId?: string;
  parentId?: string;
  ancestorIds: string[];
  title: Text;
  subtitle?: Text;
  summary?: Text;
  description?: Text;
  textLang?: string;
  kinds: string[];
  categoryAsPublished?: string;
  tags: string[];
  audience: {
    kind: string;
    minAge?: number;
    maxAge?: number;
    restricted?: Text;
  };
  placeIds: string[];
  where?: Text;
  span?: { starts: Date; ends: Date; startDate: string; endDate: string };
  officialSpan?: { startDate: string; endDate: string };
  offers: Offer[];
  pricing: Pricing;
  links: Link[];
  media: MediaRef[];
  status: EventStatus;
  statusNote?: Text;
  replacedBy?: string;
  /** The editorial override that corrected this record, when one does. */
  overriddenBy?: string;
  changes: Change[];
  visibility: Visibility;
  visibilityRule?: string;
  highlight?: { from: Date; to: Date; rank?: number };
  edition?: {
    status: 'announced' | 'programme-partial' | 'programme-complete' | 'over';
    dayStartsAt: string;
    guests?: Text[];
  };
  /** Folded title, subtitle, tags and places, for search. */
  searchText: string;
  provenance: Provenance;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OccurrenceKind = 'session' | 'run' | 'window';

export interface OccurrenceDoc {
  _id: string;
  eventId: string;
  ancestorIds: string[];
  placeId?: string;
  kind: OccurrenceKind;
  starts: Date;
  ends?: Date;
  allDay?: true;
  precision: 'exact' | 'day' | 'approximate' | 'tbc';
  every?: number;
  /** For a run: its daily hours, as the source wrote them, by weekday. */
  hours?: { days: number[]; opens: string; closes?: string }[];
  localDate: string;
  localTime?: string;
  localEndDate?: string;
  localEndTime?: string;
  status: 'scheduled' | 'changed' | 'cancelled' | 'sold-out' | 'removed';
  sourceKey: string;
  provenance: Provenance;
  version: number;
}

export interface PlaceDoc {
  _id: string;
  slug: string;
  slugHistory: string[];
  type: 'venue' | 'area' | 'point';
  kinds: string[];
  name: Text;
  aliases: string[];
  parentId?: string;
  ancestorIds: string[];
  geo?: { type: 'Point'; coordinates: [number, number] };
  address?: {
    street?: string;
    postalCode?: string;
    locality: string;
    district?: string;
  };
  hoursText?: string;
  contact?: { phone?: string; email?: string; website?: string };
  links: Link[];
  media: MediaRef[];
  admission?: { note?: Text };
  description?: Text;
  /** The source's own pick: listed first where nothing else orders them. */
  featured?: boolean;
  status: 'open' | 'temporarily-closed' | 'closed' | 'removed';
  replacedBy?: string;
  searchText: string;
  provenance: Provenance;
  version: number;
}

export interface SeriesDoc {
  _id: string;
  slug: string;
  slugHistory: string[];
  name: Text;
  summary?: Text;
  kinds: string[];
  media: MediaRef[];
  links: Link[];
  recurrence: {
    pattern: 'yearly' | 'seasonal' | 'irregular';
    usualMonths?: number[];
    rule?: DateRule;
    precision: Precision;
  };
  display: { showBeforeDays: number; hideAfterDays?: number };
  currentEditionId?: string;
  nextExpected?: {
    startDate: string;
    endDate: string;
    precision: Precision;
    basis: 'announced' | 'rule' | 'usual-months';
  };
  searchText: string;
  provenance: Provenance;
  version: number;
}
