# Agenda — ingestion

How data gets from its sources into the published collections, and how it
stays right.

```
 source ─▶ adapter ─▶ raw_records ─▶ normalise ─▶ resolve ─▶ merge ─▶ validate ─▶ publish ─▶ change_log
                     (as received)   (our shape)  (identity)  (precedence)  (invariants)  (version++)
                                                     │           │
                                                     └───────────┴──▶ reviews (a person decides)
```

## Sources

Each source is registered in `content/config/sources.yml`, with:

- its licence and attribution;
- its schedule;
- its confidence;
- its precedence per facet (see Merging).

| Source id | What | How | When |
|---|---|---|---|
| `city.agenda` | The city's event service: activities, places, sessions, programmes | `cultura/evento/list.json`, `srsname=wgs84`, `q=endDate=ge=<today>`, sorted by id, pages of 500 | Every 6 h, backing off to 12 h and 24 h while the city fails; never hourly, see `apps/agenda/README.md` |
| `city.facilities` | Museums and other venues: address, point, hours, contact | `equipamiento/list.json`, category *Museos* and others as needed | Weekly |
| `city.nightlife` | Discos, as `venue.club`: the records of *Salas de Música* (category 880) and of the venues that signed the protocol against sexist aggression (1960) that `DISCOS` in `normalise.ts` names, reviewed by hand, since the city's lists mix them with cafés, rock bars and concert rooms | `equipamiento/list.json` by category id | With every run |
| `city.monuments` | The city's 179 monuments, as `landmark`: description, picture, hours, prices, its own picks as `featured` | `monumento/list.json` | With every run |
| `editorial` | Hand-written series, editions, programmes, activities, places, agents, notices and corrections | The editorial collections, through the admin API | On every publish |
| `pdf.<edition>` | An edition's printed programme, parsed into editorial drafts | A parser per programme format, run by hand; it writes `draft` documents a person reviews and publishes | Once per edition |
| `seller.ticketmaster` | Prices, tiers, ticket pages, availability | The Discovery API | Daily; hourly in an act's week |
| `seller.entradium`, `seller.wegow`, `seller.giglon`, `seller.<venue>` | The same | The seller's event pages, one adapter each | Daily; hourly in an act's week |
| `organizer.<name>` | What official programmes leave out: food truck line-ups, Oktoberfest, Champions Burger's stands, Gastroweek's tapas, a circus's sessions | One adapter each, or `content` when the site is a picture | Weekly; daily during an edition |
| `city.mobility` | Street closures, diversions, special services | The city's notices; the `zaragoza` service's tram alerts | Daily during an edition |

An adapter is one class with three methods:

1. `fetch()` returns raw records, each with the source's own key.
2. `normalise(raw)` returns candidates in our shapes: events, occurrences,
   places, agents, participations, offers and notices. Each candidate
   carries its source key and a `FacetSource` per facet it speaks to.
3. `describe()` returns the facets it can speak to.

Adapters know nothing about our ids, the database or other sources.

## Raw first

- Every record is stored as received in `raw_records`, keyed by source and
  ref, with a content hash. An unchanged hash is not reprocessed.
- Changing a rule means replaying from `raw_records`, not refetching.
- A record no longer returned gets `goneAt` and is kept. The city expires
  its records once an event is over, and we are the archive.

## Normalise

- **HTML to Markdown.** HTML becomes the restricted Markdown in the data
  model. Nothing with a tag is stored.
- **Weekly patterns to occurrences.** The city's `openingHours` (day of week
  plus times, within a date range) become occurrences within the horizon:
  120 days ahead, and the whole span for anything inside an edition.
- **Programme phrasings to occurrences.** The phrasings found in Pilar's
  programme ([research.md](research.md)) map as follows:
  - "Sesiones a las…" and "Funciones:…" become sessions;
  - "De 11:00 a 14:00 y de 17:00 a 21:00" becomes a run with split hours;
  - "Pases cada 30 minutos de…" becomes a window.
- **Listing day.** A time before the edition's `dayStartsAt` is listed under
  the previous date.
- **Prices to offers.** Each tier is kept by name. "Gratuito" and
  "Gratuita" become `free: true`, with the source's provenance. A price
  that is not given stays absent.
- **The source's label is kept.** It goes into `categoryAsPublished`. Kinds
  come from mapping tables in `content/config/mappings/`, then from rules on title
  and place, then from review.

## Resolve: identity

The step that keeps ids permanent.

1. **Exact.** If `identities` knows `(source, ref)`, the candidate is that
   entity.
2. **Matched.** Otherwise it is scored against existing entities.
   - **Events:** title similarity (normalised, accents folded), the same
     place or a place within 150 m, and an overlapping time.
   - **Places:** name or alias similarity, and distance.
   - **Agents:** name or alias.

   | Score | Result |
   |---|---|
   | ≥ 0.9 | Linked automatically, `method: matched` |
   | 0.6–0.9 | A `match` review |
   | < 0.6 | A new entity |
3. **Manual.** A decision in the editorial store (an override, or a
   resolved review) writes `method: manual`, and nothing overrides it.

The same event arriving from the city, from a programme PDF and from a
ticket seller therefore becomes one event with three identities, not three
events.

## Merge: precedence

Each facet of an entity is taken from the source that ranks highest *for
that facet*, among those that currently speak to it.

| Facet | Highest → lowest |
|---|---|
| schedule | editorial (verified) → organizer → city.agenda → seller → pdf → reported |
| place | editorial → organizer → city.agenda → pdf → seller |
| pricing | editorial (verified) → seller → organizer → city.agenda → pdf |
| booking | seller → organizer → editorial → city.agenda |
| availability | seller, only, and only when observed within the last 24 h |
| text, media | editorial → organizer → city.agenda → seller → pdf |
| classification | editorial → mappings → inferred |

- **Disagreements that matter go to review.** When a lower-ranked source
  disagrees with the winner on schedule or place, it is a `conflict`
  review. Examples: a seller says 21:00 where the city says 20:00, or a
  newer source says another venue. The published value does not change
  until a person decides.
- **Lower-ranked text fills gaps.** It is never discarded: a city
  description fills in for a missing organizer one.
- **Verified beats newer.** A verified `editorial` value beats any automatic
  source until its `verifiedAt` is older than the source's
  `observedAt`. Then a newer automatic change raises a `conflict` instead
  of being ignored.

## Disappearance

| A record stops appearing | Before its event starts | After its event ends |
|---|---|---|
| From the authority for its schedule | `disappeared` review (it may have been cancelled), status unchanged | Normal: kept as archive |
| From any other source | That source's facets lose it at the next merge | Normal |

A seller's sold-out flag older than 24 hours reverts to `unknown`, so we
never show yesterday's "sold out" as today's.

## Visibility

Rules in `content/config/filters.yml` set `visibility`, and each record keeps the
rule that set it. As much as possible is kept.

| Result | Rules |
|---|---|
| `listed` | Everything not caught below |
| `searchable` | Courses and workshops (*Cursos y talleres*, *Formación*, *Idiomas*, *Desarrollo personal*, *Empleo y Empresa*); activities for one restricted audience; activities running more than 14 days that are not exhibitions, fairs, festivals or festivities |
| `hidden` | Anything ended before it was first imported; anything outside the city's bounding box (races in Muel, Borja…); *Lugar por determinar* until a place is known; duplicates pending a merge |

Bullfighting, religious acts and everything in an official programme is
`listed`. Readers filter by kind.

## Validate

Before publishing, every entity is checked against the data model's
invariants:

- an activity has a place, a route or a `where`;
- ancestors are consistent;
- pricing agrees with offers;
- points fall within the bounding box unless a rule allows otherwise;
- an occurrence's start is before its end;
- every code exists in the taxonomy.

A failure holds that entity back, leaves its published version as it was,
and is recorded in the run.

## Publish

- Write only what changed. Increment `version`, set `updatedAt`, and append
  to `change_log`.
- For a schedule, place, status or pricing change a reader would care about,
  add a `Change` with its summary and set `status: changed` while it is
  recent.
- Recompute the derived fields:
  - `span` and `pricing` on events;
  - `currentEditionId` on series;
  - `ancestorIds` down a subtree that moved.
- Hand new images to the media service, which stores them once by hash,
  with their credit (media.md).

## Reliability, as readers see it

- **Every event says how sure we are and when it was checked.** That is
  `reliability.level`, the weakest of schedule, place and pricing, plus
  `checkedAt`.
- **Every source is credited where its data is shown** (`meta.attribution`).
- **Changes are announced.** "Time changed", "Cancelled" and "Now at…" stay
  on the event, not only in a log.
- **An edition's hand-written content must be fresh.** A daily job warns
  when an edition starting within 30 days has `editorial` facets that have
  not been verified in the last 14 days.
- **The review queue is visible to whoever maintains the data.** Open
  conflicts on events in the next 7 days are a daily alert, not a backlog.

## Jobs

- Each source runs on its own schedule.
- Running a linked edition raises the frequency of the sources tied to it
  for the edition's span plus three days either side.
- Runs are idempotent. Two at once on the same source are refused by a lock
  in MongoDB.
- Every run records counts (fetched, unchanged, created, updated, held
  back, reviews opened) and errors in `runs`.
