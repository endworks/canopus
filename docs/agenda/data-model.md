# Agenda — data model

MongoDB, database `agenda`. The published collections are what the API reads.
The operational ones are the service's own bookkeeping, and no client sees
them.

Notation is TypeScript. `?` means the field may be absent, and absent always
means *unknown*. `null` is never stored.

## Conventions

| Thing | Rule |
|---|---|
| Ids | `<prefix>_<ULID>`, e.g. `evt_01JD3Q8Z4K7M2N5P8R0T3V6X9Y`. Prefixes: `ser` series, `evt` event, `occ` occurrence, `plc` place, `agt` agent, `prt` participation, `ntc` notice, `med` media. Generated once, stored as `_id`, never derived from content. |
| Slugs | `[a-z0-9-]+`, unique per collection, may change. Old ones are kept in `slugHistory` and still resolve. |
| Instants | BSON `Date`, UTC. |
| Local values | `localDate: 'YYYY-MM-DD'` and `localTime: 'HH:mm'` in `Europe/Madrid`, stored alongside the instant they come from, for listing and for display without a time-zone library. |
| Text | `Text = { es?: string, en?: string }`, at least one present. BCP 47 keys, so a language is added without a schema change. |
| Rich text | `RichText = Text` whose strings are a restricted Markdown: paragraphs, emphasis, lists and links. No HTML is ever stored: imports convert it. |
| Money | `amount` as a number in the currency's major unit, plus an ISO 4217 `currency` (`EUR`). |
| Geometry | GeoJSON, WGS84, `[longitude, latitude]` numbers. |
| Codes | Dotted lowercase codes from the taxonomy (`music.concert`). Stored as strings, validated on write against the taxonomy, never as a database enum. |
| Versioning | Every published document has `version: number`, incremented on every change, and `createdAt`/`updatedAt`. |

## Shared shapes

```ts
type Facet = 'identity' | 'schedule' | 'place' | 'pricing' | 'booking'
           | 'text' | 'media' | 'classification' | 'participants'

interface FacetSource {
  source: string          // a source id from the registry: 'city.agenda', 'content', 'pdf.pilar-2026-10', 'seller.entradium'
  ref?: string            // that source's key for the record
  url?: string            // where a person can check it
  observedAt: Date        // when we last saw it say this
  verifiedAt?: Date       // when a person checked it against `url`
  confidence: 'verified' | 'official' | 'reported' | 'inferred'
  //  verified: a person checked it
  //  official: from the organizer, the venue, the seller or the city itself
  //  reported: from a third party (a newspaper, an aggregator)
  //  inferred: derived by our own rules (a kind from a title, a place from an alias)
}

type Provenance = Partial<Record<Facet, FacetSource>>

interface Change {        // what a reader is told changed; not an audit log
  at: Date
  facet: 'schedule' | 'place' | 'status' | 'pricing'
  summary: Text           // 'Moved from 20:00 to 21:00', 'Now at Plaza del Pilar'
  occurrenceId?: string
}

interface Media {          // a reference to a document in the media service (media.md)
  id: string              // 'med_<sha256 prefix>': the content hash, so the same picture is stored once
  kind: 'image' | 'poster' | 'video'
  url: string             // '/media/v1/med_…', immutable; variants by `?w=320|800|1600`
  width: number, height: number
  alt?: Text
  credit?: string         // 'Cartel: Jesana Motilva Santaliestra'
  licence?: string        // 'CC BY 4.0'
  originalUrl?: string    // where we fetched it
  focus?: [number, number]  // 0..1 crop centre, for cards cut from posters
}

interface Link {
  kind: 'official' | 'programme' | 'tickets' | 'instagram' | 'facebook' | 'x' | 'tiktok' | 'youtube' | 'map' | 'other'
  url: string
  label?: Text
}

interface Offer {         // after schema.org/Offer
  id: string              // stable within the event: 'general', 'anticipada', 'ninos'
  name?: Text             // 'General', 'Anticipada', 'Niños/as'
  free?: true             // a fact, with its own provenance; never inferred from a missing price
  price?: number          // a single price
  minPrice?: number, maxPrice?: number   // a range when tiers are not listed
  currency: 'EUR'
  conditions?: Text       // 'until full', 'with registration', 'fees extra', '+3 years'
  url?: string            // the seller's own page for this event or session, as the seller publishes it; never a search,
                          // never with tracking: affiliate parameters are applied when serving (see affiliate_programs)
  sellerId?: string       // agt_
  availability: 'on-sale' | 'few-left' | 'sold-out' | 'not-yet-on-sale' | 'at-door-only' | 'registration' | 'unknown'
  validFrom?: Date        // on sale from
  occurrenceIds?: string[] // when the offer is for some sessions only
  provenance: FacetSource
}

type Pricing = 'free' | 'paid' | 'mixed' | 'unknown'   // derived from offers, for filters

interface OpeningHours {
  // Days 1 (Monday) … 7. Times 'HH:mm', and past midnight as '25:00' … '29:59'
  // (the OpenStreetMap convention), so '17:00–29:00' is 'until 5 in the morning'.
  regular: { days: number[], opens: string, closes: string }[]
  from?: string, to?: string          // local dates the regular hours hold between
  exceptions: { date: string, closed?: true, ranges?: { opens: string, closes: string }[], note?: Text }[]
  note?: Text                         // the source's own words, always kept: 'Festivos: consultar'
}

interface Address {
  street?: string, postalCode?: string, locality: string, district?: string   // district: the city's junta
}

interface Accessibility {
  stepFree?: boolean, adaptedToilet?: boolean, hearingLoop?: boolean,
  guideDogs?: boolean, signLanguage?: boolean, relaxed?: boolean,   // relaxed: sensory-friendly, 'sin ruido'
  note?: Text
}
```

## Published collections

### `series`

Something that comes back. It has no dates.

```ts
{
  _id: 'ser_…', slug: 'fiestas-del-pilar', slugHistory: string[]
  name: Text
  summary?: Text
  kinds: string[]                 // 'festivity.patronal'
  media: Media[]
  links: Link[]
  recurrence: {
    pattern: 'yearly' | 'seasonal' | 'irregular'
    usualMonths?: number[]        // shown as 'usually in October' when no date can be predicted
    rule?: { start: DateExpr, end: DateExpr }   // how to predict the next edition; see below
    precision: 'day' | 'weekend' | 'month' | 'season'   // how exact a prediction from this rule is
    note?: Text
  }
  nextExpected?: {                // derived on publish and daily; never an event, never an id
    startDate: string, endDate: string   // local dates
    precision: 'day' | 'weekend' | 'month' | 'season'
    basis: 'announced' | 'rule' | 'usual-months'
    //  announced: an edition exists with these dates (it is then also an event)
    //  rule: computed from recurrence.rule, not yet confirmed by anyone
    //  usual-months: only the months are known
  }
  display: { showBeforeDays: number, hideAfterDays?: number }  // 45 by default; past editions show until the next is upcoming, unless hideAfterDays says otherwise
  currentEditionId?: string       // derived on publish: see "Current edition"
  provenance: Provenance
  version, createdAt, updatedAt
}
  unique: slug
```

**Current edition**, worked out on every publish, in this order:

1. one that is on;
2. else the next one that is announced and within `showBeforeDays`;
3. else the last one that happened, shown as **ended**, until the next one
   becomes upcoming (or `hideAfterDays` passes, for a series that should
   disappear sooner).

So a series always has something to show from its first edition on. Between
editions it is the last one, greyed, with "usually in October" from
`recurrence`. An ended edition is never removed: its whole programme stays
at its own id, as the archive.

An edition is never chosen by year: a series may have several in a year.

For now, a series shows only its **latest** edition: the current one, or the
last one greyed. Older editions are kept if we have them, but no route
lists them by default and none is imported on purpose (README, phases).

**Predicting the next edition.** Most big dates follow a calendar rule, so
the app can say "expected 9–17 October 2027 · in 320 days" long before
anyone announces it. A rule is two date expressions:

```ts
type DateExpr =
  | { fixed: { month: number, day: number }, yearOffset?: number }   // Halloween: 31 Oct; Reyes: 6 Jan of the next year
  | { easter: number }                                               // days from Western Easter Sunday: Palm Sunday is -7
  | { weekday: 1..7, onOrBefore?: DateExpr, onOrAfter?: DateExpr }   // the Monday on or before 12 Oct
  | { offset: number, of: DateExpr }                                 // two days before that
  | { last: { weekday: 1..7, month: number } }                       // the last Friday of November
  | { ifWeekday: { of: DateExpr, is: number[] }, then: DateExpr, else: DateExpr }   // a holiday moved to Monday
```

- **A small evaluator, with tests, computes `nextExpected`** for the
  coming occurrence of the rule.
- **Every rule is back-tested.** On save it must reproduce the dates of the
  editions we know, as recorded in research.md, or it is refused. A rule
  that fits only roughly is saved with a coarser `precision`.
- **An announced edition wins.** As soon as an edition exists with its own
  dates, `basis` becomes `announced` and the rule is not used for that
  year.
- **A series with no rule** (Champions Burger moves every year) has only
  `usualMonths`: "usually in March or April", with no countdown.
- **Rules are editorial data,** so they are corrected without a deploy.

### `events`

Everything that happens, as a tree.

```ts
{
  _id: 'evt_…', slug, slugHistory: string[]
  type: 'edition' | 'programme' | 'activity'
  seriesId?: string               // editions only
  parentId?: string               // a programme's edition; an activity's programme or edition
  ancestorIds: string[]           // root first; [] for a root

  title: Text
  subtitle?: Text                 // 'presenta Corto Milenio'
  summary?: Text                  // plain, ≤ 280 characters, for lists and cards
  description?: RichText
  textLang?: string               // the language the text is in, when only one: 'es' for the city's

  kinds: string[]                 // taxonomy codes, primary first: ['music.concert', 'family']
  categoryAsPublished?: string    // the source's own label, kept: 'Acto religioso'
  tags: string[]                  // free words for search: 'aire libre', 'jota'
  audience: {
    kind: 'all' | 'family' | 'children' | 'youth' | 'adults' | 'seniors' | 'professional'
    minAge?: number, maxAge?: number
    restricted?: Text             // 'women only': kept, and lowers visibility (ingestion.md)
  }
  accessibility?: Accessibility
  languages?: string[]            // the language performed in, when it matters

  placeIds: string[]              // where; primary first
  where?: Text                    // when no place says it: 'Itinerante', 'Casco Histórico'
  route?: {                       // a parade, a procession, a race
    stops: { name: string, role: 'start' | 'via' | 'end', placeId?: string, point?: GeoJSON.Point }[]
    line?: GeoJSON.LineString
  }
  area?: GeoJSON.Polygon | GeoJSON.MultiPolygon   // where an edition or a programme spreads

  span: {                         // derived from occurrences on publish
    starts: Date, ends: Date
    startDate: string, endDate: string   // local
  }
  officialSpan?: { startDate: string, endDate: string }   // editions: the dates as announced (Pilar: 10–18 Oct)
                                  // the span can be wider: the circus ran to 2 Nov
  schedule?: {                    // how occurrences are generated, when they are not listed one by one
    rrule: string                 // RFC 5545: 'FREQ=WEEKLY;BYDAY=FR,SA;UNTIL=20261231T225959Z'
    dtstart: string               // local 'YYYY-MM-DDTHH:mm'
    duration?: string             // ISO 8601: 'PT2H'
    exdates?: string[]
    rdates?: string[]
  }
  hours?: OpeningHours            // a programme's or a run's own hours: the fairground's

  offers: Offer[]
  pricing: Pricing                // derived
  links: Link[]
  media: Media[]

  status: 'scheduled' | 'changed' | 'postponed' | 'cancelled' | 'removed'
  //  changed: on, but its time or place moved since first published (see changes)
  //  removed: published in error or merged; never shown in lists, still answers by id
  statusNote?: Text
  replacedBy?: string             // set with 'removed' when merged into another event
  changes: Change[]               // newest first, the last 20

  visibility: 'listed' | 'searchable' | 'hidden'
  visibilityRule?: string         // the rule that set it, for audit
  highlight?: { from: Date, to: Date, rank?: number, media?: Media }

  edition?: {                     // type 'edition' only
    status: 'announced' | 'programme-partial' | 'programme-complete' | 'over'
    dayStartsAt: string           // '06:00': an act before it is listed under the night before
    poster?: Media
    guests?: Text[]               // 'Venezuela, país invitado'
    info?: { phones?: string[], placeIds?: string[] }   // the 010 line, tourist offices
  }

  provenance: Provenance
  version, createdAt, updatedAt
}
  unique: slug
  index: { parentId: 1 }, { ancestorIds: 1 }, { seriesId: 1, 'span.starts': -1 }
  index: { type: 1, 'span.ends': 1 }, { kinds: 1 }, { placeIds: 1 }
  index: { 'highlight.to': 1 } partial on highlight
  text:  { 'title.es': 10, 'title.en': 10, 'subtitle.es': 5, tags: 5, 'summary.es': 2 }  default_language 'spanish'
```

Invariants, checked before anything is published:

- An activity has at least one of `placeIds`, `route` or `where`.
- `ancestorIds` is exactly the chain of `parentId`s.
- An edition has a `seriesId` and an `edition` block; nothing else has them.
- `pricing` agrees with `offers`: `free` only when every offer is free,
  `unknown` when there are none.
- A `removed` event has no occurrences that are listed.

### `occurrences`

When. One document per session, per run, or per window.

```ts
{
  _id: 'occ_…'
  eventId: string
  ancestorIds: string[]           // the event's, plus the event: one query finds a whole edition's sessions
  placeId?: string                // only when this session is somewhere else than the event's first place

  kind: 'session' | 'run' | 'window'
  //  session: it starts (and maybe ends): a concert
  //  run: open across days, during hours: an exhibition, a market, a fairground
  //  window: repeats inside a range: 'pases cada 30 minutos de 17:00 a 22:30'
  starts: Date
  ends?: Date
  allDay?: true
  precision: 'exact' | 'day' | 'approximate' | 'tbc'
  //  day: the day is known, the time is not ('fireworks, after the concert')
  //  approximate: 'around', 'a continuación'
  //  tbc: announced, not yet scheduled
  every?: number                  // minutes, windows only
  hours?: OpeningHours            // runs only, when not the event's or the place's

  localDate: string               // the day it is LISTED under: 00:30 on the 12th is the 11th's night
  localTime?: string              // 'HH:mm', absent unless precision is exact or approximate
  localEndDate?: string, localEndTime?: string

  status: 'scheduled' | 'changed' | 'cancelled' | 'sold-out' | 'removed'
  offers?: Offer[]                // when this session sells apart from the event's
  sourceKey: string               // deterministic: hash(eventId, local start, placeId) — regeneration keeps ids
  provenance: Provenance          // schedule, at least
  version, createdAt, updatedAt
}
  index: { localDate: 1, status: 1 }, { starts: 1 }, { ends: 1 }
  index: { eventId: 1, starts: 1 }, { ancestorIds: 1, localDate: 1 }, { placeId: 1, starts: 1 }
  unique: { eventId: 1, sourceKey: 1 }
```

"On today" means `starts < end of day` and `ends ≥ start of day`, which
catches a run that began last month. `localDate` is for listing a session
under its day, not for runs.

Regeneration from a `schedule` keeps an occurrence's id whenever its
`sourceKey` survives. A session that disappears while another appears on
the same day is recorded as a move, with a `Change`, not as one removal and
one new session.

### `places`

Where. A tree: a stage inside a square, a hall inside a civic centre.

```ts
{
  _id: 'plc_…', slug, slugHistory: string[]
  type: 'venue' | 'area' | 'point'
  //  venue: a building or a space with an entrance
  //  area: a square, a park, a fairground, a neighbourhood
  //  point: a service: toilets, first aid, an info point
  kinds: string[]                 // 'venue.theatre', 'venue.museum', 'area.square', 'service.toilets', 'stage.temporary'
  name: Text
  aliases: string[]               // how programmes write it: 'Esc. Ambar Fuente de Goya', 'C.C. Delicias'
  parentId?: string, ancestorIds: string[]

  geo: GeoJSON.Point
  footprint?: GeoJSON.Polygon     // an area's outline
  address?: Address
  hours?: OpeningHours
  contact?: { phone?: string, email?: string, website?: string }
  links: Link[]
  media: Media[]
  accessibility?: Accessibility
  admission?: { free?: 'always' | 'some-days', note?: Text }   // museums: 'free on Sundays'
  temporary?: { eventId: string, from: string, to: string }    // exists only for an edition: a stage, a toilet block

  status: 'open' | 'temporarily-closed' | 'closed' | 'removed'
  replacedBy?: string
  provenance: Provenance
  version, createdAt, updatedAt
}
  unique: slug
  index: { geo: '2dsphere' }, { kinds: 1 }, { parentId: 1 }, { 'temporary.eventId': 1 }
  text:  { 'name.es': 10, aliases: 8 }
```

The city's facilities, the agenda's places and the programmes' directories
all name the same buildings differently. Every name a source has used goes
into `aliases`, and matching uses them.

### `agents`

Who: organizations and people.

```ts
{
  _id: 'agt_…', slug, slugHistory: string[]
  type: 'organization' | 'person'
  kinds: string[]                 // 'vendor.food-truck', 'performer.band', 'organizer.public', 'seller.ticketing'
  name: string
  aliases: string[]
  summary?: Text
  media: Media[]
  links: Link[]
  cuisine?: string[]              // vendors: 'burgers', 'mexican'
  status: 'active' | 'removed', replacedBy?: string
  provenance: Provenance
  version, createdAt, updatedAt
}
  unique: slug
  text: { name: 10, aliases: 8 }
```

### `participations`

An agent's role in an event, and anything that belongs to that role.

```ts
{
  _id: 'prt_…'
  eventId: string, ancestorIds: string[]
  agentId: string
  role: 'organizer' | 'co-organizer' | 'performer' | 'vendor' | 'sponsor' | 'seller' | 'host'
  order?: number                  // billing order: the headliner first
  placeId?: string                // a vendor's own place: a Gastroweek restaurant
  pitch?: Text                    // 'Stand 14', 'beside the main stage'
  hours?: OpeningHours            // when it differs from the event's
  offerings: {                    // a menu, a product list
    id: string
    name: Text
    description?: Text
    price?: number, currency?: 'EUR'
    dietary?: ('vegetarian' | 'vegan' | 'gluten-free' | 'lactose-free' | 'halal')[]
    media?: Media
    featured?: true               // the competition burger, Gastroweek's tapa
  }[]
  provenance: Provenance
  version, createdAt, updatedAt
}
  index: { eventId: 1, role: 1, order: 1 }, { agentId: 1 }, { ancestorIds: 1, role: 1 }
  unique: { eventId: 1, agentId: 1, role: 1 }
```

### `notices`

A dated note that is not an event.

```ts
{
  _id: 'ntc_…'
  kinds: string[]
  //  'mobility.street-closure', 'mobility.diversion', 'mobility.special-service',
  //  'mobility.extended-hours', 'mobility.parking', 'discount', 'accessibility.relaxed',
  //  'safety', 'weather', 'info'
  title: Text
  body?: RichText
  severity: 'info' | 'warning' | 'critical'
  when: { starts: Date, ends: Date }[]
  scope: { eventIds?: string[], placeIds?: string[] }   // empty: the whole city
  geometry?: GeoJSON.Geometry     // the closed streets
  lines?: string[]                // transport lines affected or added: 'bus:21', 'bus:N1', 'tram:L1'
  status: 'active' | 'cancelled' | 'removed'
  provenance: Provenance
  version, createdAt, updatedAt
}
  index: { 'when.ends': 1 }, { 'scope.eventIds': 1 }, { kinds: 1 }, { geometry: '2dsphere' } sparse
```

The `lines` codes are `<mode>:<line>`, the same keys the transport side of
the app uses, so the app can join a closure to the stops it already knows.

## Editorial collections

What people write lives in its own collections, never in the published
ones. It is one more source, `editorial`, with the highest precedence:

- `editorial_series`, `editorial_events`, `editorial_places`,
  `editorial_agents`, `editorial_participations`, `editorial_notices`;
- `editorial_overrides`: corrections on other sources' records.

These have the published shapes, with three differences:

- **Occurrences are written in the shorthand** of content.md: `sessions`,
  `runs`, `windows`, `schedule`.
- **Each document has `state: 'draft' | 'ready' | 'published'`.** Only
  `published` reaches the merge.
- **Each carries `verified: { url, at, by }`** where a fact was checked.

A publish of an editorial document runs the same pipeline as any source, so
an editor's fix goes out in seconds, through the same validation.

## Operational collections

None of these is ever served.

```ts
sources {                         // the registry; written from content/config/sources.yml
  _id: 'city.agenda' | 'content' | 'seller.entradium' | …
  name: string
  licence?: string, attribution?: string   // shown to readers when its data is
  precedence: Partial<Record<Facet, number>>   // higher wins; see ingestion.md
  confidence: FacetSource['confidence']
  schedule: string                // cron
}

raw_records {                     // as received, never edited
  _id, source: string, ref: string
  payload: object, hash: string
  firstSeenAt: Date, lastSeenAt: Date, goneAt?: Date
}
  unique: { source: 1, ref: 1 }

identities {                      // a source's key → our id. The reason ids survive re-imports.
  _id, source: string, ref: string
  collection: 'events' | 'places' | 'agents' | 'occurrences'
  entityId: string
  method: 'exact' | 'matched' | 'manual'
  score?: number
  createdAt: Date
}
  unique: { source: 1, ref: 1, collection: 1 }
  index: { entityId: 1 }

reviews {                         // what a person has to decide
  _id
  kind: 'match' | 'conflict' | 'classification' | 'parse' | 'disappeared'
  subject: { collection: string, id?: string, source: string, ref: string }
  detail: object                  // candidates with scores, the two disagreeing values, the line that would not parse
  status: 'open' | 'resolved' | 'dismissed'
  resolution?: { by: string, at: Date, override?: string }   // the editorial override that settled it
  createdAt: Date
}
  index: { status: 1, kind: 1, createdAt: -1 }

change_log {                      // feeds GET /changes
  _id: number                     // a monotonic sequence, from a counter document
  collection: string, id: string
  op: 'upsert' | 'remove'
  at: Date
}
  index: { at: 1 }  TTL 35 days

runs { _id, source, startedAt, finishedAt, counts: object, errors: object[] }

affiliate_programs {              // from content/config/affiliates.yml
  _id: string                     // 'ticketmaster', 'awin.entradium'
  sellerIds: string[]             // which agents' offers it applies to
  match: string[]                 // URL hosts it applies to: 'www.ticketmaster.es'
  kind: 'query' | 'wrapper'
  query?: Record<string, string>  // parameters added to the seller's URL
  wrapper?: string                // a template: 'https://www.awin1.com/cread.php?awinmid=…&awinaffid=…&ued={url}'
  active: boolean
  from?: Date, to?: Date
}

revisions {                       // every change a person makes to editorial data (content.md)
  _id
  collection: string, entityId: string
  op: 'create' | 'update' | 'delete' | 'publish' | 'unpublish'
  before?: object, after?: object // the editorial document, whole
  by: string                      // the token's owner
  reason?: string
  at: Date
}
  index: { collection: 1, entityId: 1, at: -1 }, { at: -1 }
```

## Sizing

At November 2026's volume, with Pilar's 750 acts at the peak:

| Collection | Documents |
|---|---|
| `events` | ~4,000 a year |
| `occurrences` | ~15,000 live within the 120-day horizon |
| `places` | ~1,500 |

All of it is far inside a single small MongoDB. The indexes above serve
every route in [api.md](api.md) without a collection scan. Search uses
MongoDB's text index with the Spanish analyser, which ignores diacritics.
Moving to Atlas Search, or to an engine of its own, is possible later
without changing the API.
