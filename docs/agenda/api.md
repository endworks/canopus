# Agenda — API v1

The gateway exposes it at `/zgz/agenda/v1`, over HTTPS and JSON, and documents
it in the gateway's Swagger like every other service. This document is the
contract: what is written here is what clients may rely on.

It sits under `/zgz` because it is Zaragoza's, beside the city's stops and its
search. It was first served at `/agenda/v1`, which the app's 1.1.0 (builds 458
and 459) asks, so every route answers at both paths, identically, until no
installed build uses the old one.

## The compatibility contract

**Within v1 the server may:**

- add routes, query parameters, fields, and values to any enumeration or
  code list;
- add objects to `included`;
- make a field that was always present sometimes absent, if it never meant
  anything when present.

**Within v1 the server never:**

- removes, renames or retypes a field;
- changes the meaning of a value;
- changes an id;
- changes an error's `code`.

**Clients must:**

- ignore fields they do not know;
- treat an unknown code by its dotted parent (`music.cumbia` → `music`),
  then as `other`;
- treat an unknown `status` as `scheduled`, and an unknown `availability`
  as `unknown`;
- treat an absent field as unknown, never as false, zero or free;
- follow `replacedBy` and `410` responses to the surviving id.

**Breaking changes** ship as `/agenda/v2` beside v1. v1 keeps answering for
at least twelve months after v2's first release, because installed apps
outlive releases.

## Conventions

| | |
|---|---|
| Names | camelCase. |
| Instants | ISO 8601 with the local offset: `2026-10-12T08:00:00+02:00`. |
| Local values | `localDate` `2026-10-12`, `localTime` `08:00`, always next to the instant. |
| Coordinates | GeoJSON `[longitude, latitude]` numbers. |
| Money | `{ "amount": 25, "currency": "EUR" }`. |
| Language | `?lang=es\|en`, else `Accept-Language`, else `es`. Text comes back resolved to that language as a plain string; where a text exists only in another language it comes back in that language, and the object says so in `textLang`. |
| Images | `{ url, width, height, alt?, credit? }`; `url` takes `?w=320\|800\|1600`. |
| Lists | Cursor-paginated: `?limit=` (default 50, max 200) and `?cursor=` from `meta.next`. Order is fixed per route and stated below. |

## Envelope

Every success is:

```json
{
  "data": …,
  "included": {
    "events": { "evt_…": { … } },
    "places": { "plc_…": { … } },
    "agents": { "agt_…": { … } },
    "series": { "ser_…": { … } }
  },
  "meta": {
    "generatedAt": "2026-11-23T10:00:00+01:00",
    "lang": "es",
    "next": "opaque-cursor",
    "attribution": [
      { "source": "city.agenda", "name": "Ayuntamiento de Zaragoza", "licence": "CC BY 4.0", "url": "https://www.zaragoza.es/sede/portal/datos-abiertos/" }
    ]
  }
}
```

- **References.** Objects refer to each other by id. Everything a response
  refers to is in `included` once, keyed by id, in its summary form, so a
  client keeps one cache per type and a list never repeats a venue 40
  times.
- **Expansion.** `?include=` asks for more where a route offers it.
- **Attribution.** `meta.attribution` lists every source whose data is in
  the response. Clients must show it where they show that data: this is
  the city's licence condition, and it is how readers see where facts come
  from.

Every error is:

```json
{ "error": { "code": "not_found", "message": "No event evt_01JD…" } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `invalid_param` | A parameter is malformed; `error.param` names it |
| 401 | `unauthorized` | An admin route without a valid token |
| 404 | `not_found` | No such id or slug |
| 410 | `gone` | Removed. `error.replacedBy` holds the survivor when it was merged |
| 410 | `cursor_expired` | A change-feed cursor older than 30 days: refetch the feed |
| 429 | `rate_limited` | `Retry-After` says when |
| 503 | `unavailable` | The service is down; the gateway's usual answer |

## Caching

Every `GET` sends a strong `ETag` and answers `If-None-Match` with `304`.

| Route | `Cache-Control` |
|---|---|
| Feed, highlights, an edition while on | `max-age=300` |
| Everything else | `max-age=900` |
| Taxonomy | `max-age=86400` |

Responses are gzip- or brotli-compressed.

## Representations

Each type has a **summary**, which is what lists and `included` carry, and a
**detail**, which only its own route returns. A summary is a strict subset of
the detail.

### Event

```jsonc
// summary
{
  "id": "evt_01JD…",
  "slug": "houdini-un-musical-magico",
  "type": "activity",                        // edition | programme | activity
  "parentId": "evt_01JC…",                   // absent for a root
  "editionId": "evt_01JB…",                  // the nearest edition among its ancestors
  "title": "Houdini. Un musical mágico",
  "subtitle": "…",
  "summary": "…",
  "textLang": "es",
  "kinds": ["stage.musical", "family"],
  "audience": { "kind": "family", "minAge": 6 },
  "placeIds": ["plc_01J…"],
  "where": "Itinerante",
  "span": { "starts": "…", "ends": "…", "startDate": "2026-10-13", "endDate": "2026-10-18" },
  "pricing": "paid",                         // free | paid | mixed | unknown
  "priceFrom": { "amount": 18, "currency": "EUR" },
  "image": { "url": "…", "width": 1600, "height": 900, "credit": "…" },
  "status": "scheduled",                     // scheduled | changed | postponed | cancelled | removed
  "reliability": { "level": "official", "checkedAt": "2026-10-09T18:00:00+02:00" }
}

// detail adds
{
  "description": "Markdown…",
  "categoryAsPublished": "Espectáculo teatral",
  "tags": ["magia"],
  "accessibility": { "stepFree": true },
  "languages": ["es"],
  "route": { "stops": [{ "name": "Plaza de España", "role": "start", "point": { "type": "Point", "coordinates": [-0.8806, 41.6508] } }], "line": { … } },
  "area": { … },
  "officialSpan": { "startDate": "2026-10-10", "endDate": "2026-10-18" },   // editions
  "hours": { … },                                                           // OpeningHours
  "offers": [ Offer ],
  "links": [ { "kind": "official", "url": "…" } ],
  "media": [ Image ],
  "statusNote": "…",
  "changes": [ { "at": "…", "facet": "schedule", "summary": "Moved from 20:00 to 21:00" } ],
  "seriesId": "ser_…",                                                      // editions
  "edition": { "status": "programme-complete", "dayStartsAt": "06:00", "poster": Image, "guests": ["Venezuela, país invitado"], "info": { … } },
  "sources": [ { "source": "city.agenda", "facets": ["schedule", "place"], "url": "…", "checkedAt": "…", "confidence": "official" } ]
}
```

`reliability.level` is the weakest confidence among the facets a reader
acts on (schedule, place, pricing), so "verified" means all three were
checked. `sources` is the detail behind it, for an "about this information"
sheet.

### Occurrence

```jsonc
{
  "id": "occ_01J…",
  "eventId": "evt_01JD…",
  "kind": "session",                         // session | run | window
  "starts": "2026-10-13T20:00:00+02:00",
  "ends": "2026-10-13T22:00:00+02:00",
  "localDate": "2026-10-13",                 // the day it is listed under
  "localTime": "20:00",
  "precision": "exact",                      // exact | day | approximate | tbc
  "every": 30,                               // windows
  "hours": { … },                            // runs, when not the event's
  "placeId": "plc_…",                        // only when not the event's first place
  "status": "scheduled",
  "offers": [ Offer ]                        // only when this session sells apart
}
```

### Place

```jsonc
// summary
{
  "id": "plc_…", "slug": "teatro-principal",
  "type": "venue", "kinds": ["venue.theatre"],
  "name": "Teatro Principal",
  "geo": { "type": "Point", "coordinates": [-0.8790, 41.6505] },
  "parentId": "plc_…",
  "address": { "street": "Coso, 57", "postalCode": "50001", "locality": "Zaragoza", "district": "Casco Histórico" },
  "status": "open",
  "openNow": true                            // computed at response time from hours; absent when hours are unknown
}
// detail adds: footprint, hours, contact, links, media, accessibility, admission, temporary, sources
```

### Offer

```jsonc
{
  "id": "anticipada",
  "name": "Anticipada",
  "price": { "amount": 20, "currency": "EUR" },   // or "free": true, or "minPrice"/"maxPrice"
  "conditions": "Hasta el 1 de octubre",
  "url": "https://…",
  "sellerId": "agt_…",
  "availability": "on-sale",                       // on-sale | few-left | sold-out | not-yet-on-sale | at-door-only | registration | unknown
  "validFrom": "…",
  "occurrenceIds": ["occ_…"],
  "affiliate": true,                               // the link pays us
  "checkedAt": "…", "source": "seller.entradium"
}
```

**Affiliate links.**

- `url` is the link to open. When an active affiliate programme covers the
  seller, the server has already applied it.
- `affiliate: true` says so, and clients must label such a link next to it
  ("Enlace de afiliado" / "Affiliate link") and in the app's legal text.
- A link that does not pay has no `affiliate` field.
- Programmes change on the server alone. A client never builds or edits a
  ticket URL.

### Agent, participation, notice, series

```jsonc
// agent
{ "id": "agt_…", "type": "organization", "kinds": ["vendor.food-truck"], "name": "…", "summary": "…", "image": { … }, "links": [ … ], "cuisine": ["burgers"] }

// participation
{ "id": "prt_…", "eventId": "evt_…", "agentId": "agt_…", "role": "vendor", "order": 3, "placeId": "plc_…", "pitch": "Stand 14",
  "hours": { … }, "offerings": [ { "id": "…", "name": "Smash doble", "price": { "amount": 12, "currency": "EUR" }, "dietary": ["gluten-free"], "featured": true } ] }

// notice
{ "id": "ntc_…", "kinds": ["mobility.street-closure"], "severity": "warning", "title": "…", "body": "…",
  "when": [ { "starts": "…", "ends": "…" } ], "eventIds": ["evt_…"], "placeIds": [], "geometry": { … }, "lines": ["bus:21", "tram:L1"], "status": "active" }

// series
{ "id": "ser_…", "slug": "fiestas-del-pilar", "name": "Fiestas del Pilar", "summary": "…", "image": { … },
  "recurrence": { "pattern": "yearly", "usualMonths": [10] }, "currentEditionId": "evt_…",
  "nextExpected": { "startDate": "2027-10-09", "endDate": "2027-10-17", "precision": "day", "basis": "rule" } }
```

## Routes

### Feed

`GET /zgz/agenda/v1/feed?from=YYYY-MM-DD&days=30`

What the app keeps offline: every listed occurrence between `from` (default
today) and `days` later (default 30, maximum 60), with everything they refer
to.

```jsonc
{
  "data": {
    "occurrences": [ Occurrence ],           // ordered by localDate, then starts
    "highlights": [ Highlight ],             // as GET /highlights
    "comingUp": [ ComingUp ],                // as GET /series?nextWithin=365
    "notices": [ Notice ]                    // active in the window, city-wide or for an edition in it
  },
  "included": { "events": …, "places": …, "series": … },
  "meta": { …, "changesCursor": "…" }        // where GET /changes takes over from this snapshot
}
```

- Not paginated: it is a snapshot.
- At today's volume, about 520 listed activities, it is a few hundred
  kilobytes compressed. If it grows past 1 MB, `days` shrinks before the
  shape changes.

### Change feed

`GET /zgz/agenda/v1/changes?since=<cursor>&limit=500`

What changed since a cursor, so the app updates its copy without
refetching it.

```jsonc
{
  "data": [
    { "type": "event", "id": "evt_…", "op": "upsert", "entity": { …summary… } },
    { "type": "occurrence", "id": "occ_…", "op": "remove" }
  ],
  "meta": { "next": "…", "hasMore": false }
}
```

- Ordered by the change sequence.
- A cursor older than 30 days answers `410 cursor_expired`: take the feed
  again.

### Highlights

`GET /zgz/agenda/v1/highlights`

```jsonc
{
  "data": [
    {
      "eventId": "evt_…",
      "state": "on",                          // on | upcoming | ended
      "label": "Hasta el domingo",            // resolved: 'Empieza en 5 días', 'Terminó ayer'
      "image": { … },                         // the highlight's own wide picture, else the event's
      "rank": 1,
      "next": {                               // ended entries: the series' next edition
        "startDate": "2027-10-09", "endDate": "2027-10-17",
        "precision": "day",                   // day | weekend | month | season
        "basis": "rule"                       // announced | rule | usual-months
      }
    }
  ],
  "included": { "events": …, "series": … }
}
```

- Ordered:
  1. on now, the soonest end first;
  2. upcoming, by start;
  3. ended, the most recent first: a series' last edition, for 14 days after
     it ends (`display.hideAfterDays` on the series overrides it). After that
     the series is only in `/series?nextWithin`, under coming up.
- `rank` breaks ties.
- An `ended` entry carries its series' `next`, and its `label` says when it
  ended.
- An edition with no picture of its own is given the one most of its
  activities share (at least three, and a fifth of the pictured ones), set
  after each import: Navidad's is the Z its activities carry.
  - **The countdown** ("faltan 320 días") is computed by the client from
    `next.startDate`, the same way as the time state below, so it is right
    every day without a request.
  - **A prediction is labelled as one.** With `basis: rule` the app shows
    "Fechas previstas: 9–17 oct 2027". With `announced` it drops
    "previstas". With `usual-months` it shows "Normalmente en marzo o
    abril", with no countdown.
  - **Precision limits what the app claims.** With `weekend` it says "the
    weekend of 26–28 Nov"; with `month` or `season`, only the month or
    season.
- Current editions are included automatically. Hand-picked events come in
  their window.

### Coming up

`GET /zgz/agenda/v1/series?nextWithin=365`

Every series with a `nextExpected` within the window, ordered by its start:
the "Coming up" (*Próximamente*) list under the highlights, each with a
countdown.

```jsonc
{
  "data": [
    { "seriesId": "ser_…", "nextExpected": { "startDate": "2027-03-21", "endDate": "2027-03-28", "precision": "day", "basis": "rule" },
      "lastEditionId": "evt_…" }        // absent when we hold no edition of it yet
  ],
  "included": { "series": …, "events": … }
}
```

The feed carries the same list as `data.comingUp`.

### Time state: past, on, upcoming

Whether something is past is computed **by the client, from `starts` and
`ends`, against the current time**, never stored. A cached feed then greys
a session out the minute it ends, with no request.

| State | Occurrence | Event or edition |
|---|---|---|
| upcoming | `starts` is in the future | its `span.starts` is in the future |
| on | between `starts` and `ends` (or `starts` + 2 h for a session without an end) | between its span's start and end |
| past | `ends` (or that default) has passed | its `span.ends` has passed |

Clients must show past things, not hide them:

- **A past session** is drawn greyed, below or among the others as its day
  dictates.
  - Its offers' buttons are hidden. Tickets for something over are never
    offered, even when a seller's page still answers.
  - The page itself stays reachable.
- **A past event** is drawn greyed in lists, labelled "Terminado" / "Ended".
  Its page carries a banner with its dates, and stays complete: sessions,
  places, participants, vendors, notices.
- **A past edition** is fully browsable, day by day, as the archive.
  - Its banner names the next edition when there is one ("Vuelve el 9 de
    octubre de 2027"), else when it usually happens.
  - It links to the series' other editions.
- **"Today" on an edition that is on** shows past sessions greyed at the top,
  collapsed under "Ya han pasado (12)", then what is on, then what is next.

### Events

`GET /zgz/agenda/v1/events/{id | slug}?include=children,occurrences,participants,notices`

One event in detail, of any type. An old slug answers too; its response
carries the current `slug`.

| `include=` | Adds to `data` |
|---|---|
| `children` | `children`: the direct children's summaries, ordered by `span.starts` |
| `occurrences` | `occurrences`: the next 60 days of the event's own (for an edition, use the route below) |
| `participants` | `participants`: participations, ordered by role, then `order` |
| `notices` | `notices`: active notices scoped to it |

`GET /zgz/agenda/v1/events/{id}/schedule?date=YYYY-MM-DD&kinds=&placeId=&pricing=free&cursor=`

The programme of an edition or a programme, day by day: every occurrence of
every descendant. This is what an edition's page pages through.

```jsonc
{
  "data": {
    "days": [ { "localDate": "2026-10-12", "count": 93 } ],   // every day of the span, for the tabs
    "occurrences": [ Occurrence ]                             // the requested date, by starts
  },
  "included": { "events": …, "places": … }
}
```

`GET /zgz/agenda/v1/events/{id}/participants?role=vendor&dietary=vegan&maxPrice=10`

Everyone with a role in the event and its descendants. Vendors come with
their offerings, ordered by programme, then `order`.

`GET /zgz/agenda/v1/events/{id}/places?kinds=service`

Every place the event and its descendants use, temporary ones included
(stages, toilets, first aid), for the edition's map.

`GET /zgz/agenda/v1/events?kinds=&placeId=&from=&to=&pricing=&type=&parentId=&cursor=`

A list of event summaries matching all the filters, ordered by
`span.starts`. Only `listed` events unless `visibility=searchable` is asked
for.

### Places

`GET /zgz/agenda/v1/places?kinds=venue.museum&near=lon,lat&radius=2000&openNow=true&cursor=`

Ordered by distance when `near` is given, else by name.

`GET /zgz/agenda/v1/places/{id | slug}?include=happening`

`happening` adds what is on there in the next 30 days: occurrences, with
their events in `included`.

### Agents

`GET /zgz/agenda/v1/agents/{id | slug}?include=participations`

`participations` adds where the agent appears, current and upcoming first.
For example: where the food truck is this week.

### Search

`GET /zgz/agenda/v1/search?q=…&types=event,place,agent&from=&cursor=`

Searches titles, subtitles, tags, performers, aliases, vendors and dishes.

```jsonc
{ "data": [ { "type": "event", "id": "evt_…", "score": 12.4 } ], "included": { … } }
```

- Ordered by score, with upcoming events ranked above past ones.
- `searchable` records are found here, never `hidden` ones.

### Series

`GET /zgz/agenda/v1/series/{id | slug}?include=editions`

`editions` adds every edition, newest first, as summaries: the archive. A
past edition keeps its whole programme at its own route.

### Taxonomy

`GET /zgz/agenda/v1/taxonomy`

```jsonc
{
  "data": {
    "kinds":       [ { "code": "music.concert", "parent": "music", "label": "Concierto", "icon": "microphone-stage", "deprecated": false } ],
    "placeKinds":  [ … ],
    "noticeKinds": [ … ],
    "agentKinds":  [ … ]
  }
}
```

- `icon` is a Phosphor name, the set both apps already draw with.
- A deprecated code carries `replacedBy`.
- Clients cache the taxonomy for a day, and ship a copy for the first
  launch.

## Admin

Every admin route requires `Authorization: Bearer <AGENDA_ADMIN_TOKEN>`,
held in the gateway's and the service's environment and in 1Password with
the rest. None appears in the public Swagger.

| Route | Does |
|---|---|
| `POST /zgz/agenda/v1/admin/run` | Runs the whole import now: editorial, the city's agenda, the museums, the derived fields |
| `GET /zgz/agenda/v1/admin/status` | Edition mode, whether a run is due, the last good import, `stale`, open reviews by kind, the last five runs |
| `GET /zgz/agenda/v1/admin/runs?limit=` | Recent runs, with counts and errors |
| `GET /zgz/agenda/v1/admin/editorial/{collection}?state=` | The documents of one collection: `series`, `editions`, `places`, `events`, `overrides` |
| `GET /zgz/agenda/v1/admin/editorial/{collection}/{key}` | One document. A key with "/" is sent encoded, `%2F` |
| `PUT /zgz/agenda/v1/admin/editorial/{collection}/{key}` | `{ doc, state?, verified?, reason }`. Validated; refused with the reasons when invalid. A published document goes live at once |
| `POST /zgz/agenda/v1/admin/editorial/{collection}/{key}/publish` | `{ reason }`. Publishes through the pipeline; `…/unpublish` takes it back to draft, and its published entity becomes `removed` |
| `POST /zgz/agenda/v1/admin/editorial/bulk` | `{ items: [{ collection, doc }], reason }`: a whole programme as drafts, with a report of what each item became |
| `GET /zgz/agenda/v1/admin/editorial/{collection}/{key}/history` | Its revisions, newest first |
| `POST /zgz/agenda/v1/admin/revisions/{id}/revert` | `{ reason }`. Puts that revision's `before` back, as a new revision |
| `GET /zgz/agenda/v1/admin/export` | Every editorial document and 90 days of revisions: the backup, and a way out |
| `GET /zgz/agenda/v1/admin/reviews?status=open&kind=` | The review queue: `disappeared`, `stale-edition` |
| `POST /zgz/agenda/v1/admin/reviews/{id}` | `{ action: "resolve" \| "dismiss", note? }` |

`AGENDA_ADMIN_TOKEN` holds one token, or `name:token` pairs separated by
commas. The name is what revisions record as `by`.

## Clients

- **Generated from the spec.** The gateway's DTOs generate the OpenAPI
  document. A contract test checks every route's response against it,
  using fixtures of every type.
- **KMP.** Decode with `ignoreUnknownKeys`. Model codes and statuses as
  value classes over `String` with known constants, never as closed enums.
  Keep the feed as one file with its ETag, apply `/changes` on top, and
  refetch the feed on `cursor_expired`.
- **Saved items.** Store ids, never slugs. On `410` with `replacedBy`,
  rewrite the saved id.
