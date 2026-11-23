# Agenda

What is on in Zaragoza, for Zierzo's Agenda tab:

- the big dates: Fiestas del Pilar, Navidad, Semana Santa, Halloween,
  Champions Burger…;
- everything else worth going to: concerts, theatre, exhibitions, markets,
  sport;
- the museums and what they show;
- the practical side: what it costs, where to buy it, what to eat there, and
  how to get there on the day.

Status: built: phases 0 and 1 (`apps/agenda`, the gateway's `/agenda/v1` and `/zgz/search`), and from phase 2 the editorial store, corrections on other sources' records, disappearance reviews, freshness and edition mode. The rest is specification.

| Document | What it fixes |
|---|---|
| [data-model.md](data-model.md) | What is stored: the collections, their fields, their invariants and their indexes |
| [api.md](api.md) | What clients get: routes, response shapes, caching, sync, errors, and the compatibility contract |
| [ingestion.md](ingestion.md) | How data gets in: sources, identity, merging, review, reliability |
| [content.md](content.md) | How people write data in: the editorial store, its revisions, and the bulk format for a whole programme |
| [media.md](media.md) | How images are fetched, stored, resized and served from canopus |
| [research.md](research.md) | What the sources actually hold, measured in November 2026; the reasons behind the rules |

## What it is

A new NestJS service, `apps/agenda`, on MongoDB, built like `zine`. The
gateway exposes it under `/agenda/v1` and reaches it over TCP. It:

- pulls from the city, the ticket sellers and the organizers;
- keeps the editorial content people write in its own MongoDB, with a
  revision history, edited through its admin API;
- merges all of it into one model, and publishes it;
- serves images itself, through a `media` service of its own.

The configuration that behaves like code lives in `content/config/` in
this repository, reviewed and deployed with it: the taxonomy, the source
registry, the filters and the mappings.

## Words

| Word | Meaning | Readers see |
|---|---|---|
| **Series** | Something that comes back. It has no dates of its own. | Not as a word: as the name ("Fiestas del Pilar") |
| **Event** | Anything that happens. Every event is one of three types: |  |
| · edition | One time a series happens | "Fiestas del Pilar 2026" |
| · programme | A named part of an edition with its own identity, and often its own place, hours or tickets | Spaces: "Espacio Zity", "Las Food Trucks", "Recinto Ferial" |
| · activity | One thing a person can go to | "Ofrenda de Flores", a concert, an exhibition |
| **Occurrence** | When an event happens: a session, a run across days, or a window with repeats | The times |
| **Place** | Where: a venue, an area, a temporary stage, a toilet block | The map pins |
| **Agent** | Who: an organizer, a performer, a food truck, a ticket seller | Names, menus |
| **Offer** | What it costs and where to buy it | Prices, "Buy tickets" |
| **Notice** | A dated note that is not an event: a street closure, a discount day, a quiet hour | Banners, the practical tab |
| **Highlight** | An event shown at the top of the tab | **Highlights** / *Destacados* |

## The decisions that must not change

Everything else in these documents can evolve without a migration or a client
release. These cannot, so they are made now on purpose.

1. **Identifiers are opaque, prefixed and permanent.**
   - They look like `evt_01JD3Q8Z…`: a type prefix and a ULID.
   - They are never derived from a title, a date or a source's key: titles
     get corrected, dates move, sources renumber.
   - An id once published is never reused and never disappears. A merged
     duplicate answers with the id that replaced it.
   - Readable URLs use a `slug`, which may change and keeps its history.
2. **Every kind of happening is one collection, `events`, as a tree.**
   - An edition, a programme inside it and an activity inside that are the
     same document shape, linked by `parentId`, with `ancestorIds` kept
     for queries.
   - A new kind of happening is a new `kinds` code, not a new collection, a
     new route or a new client type.
   - Depth is not fixed: Navidad can hold a market that holds a stage that
     holds a concert.
3. **Time is stored as occurrences, materialised.**
   - Every session is a document with UTC instants plus the local date it
     is listed under, so "what is on today" is one indexed query.
   - Recurring rules (iCalendar RRULE) are kept on the event to regenerate
     occurrences, never queried directly.
   - A time can be exact, day-only or not yet announced, and says which.
4. **Places are their own tree, with GeoJSON points in WGS84,
   `[longitude, latitude]` as numbers.**
   - A stage sits inside a square; a toilet block belongs to an edition.
   - This differs from zine's string coordinates on purpose. It is the
     standard, and the agenda has no old clients to match.
5. **Who is involved is agents plus participations.**
   - An organizer, a performer, a vendor and a seller are all agents with a
     role in an event.
   - A food truck's menu belongs to its participation in one edition, so
     the same truck can serve different dishes at different fiestas.
6. **Every fact carries its provenance, and nothing is overwritten
   silently.**
   - Each facet of an event (schedule, place, pricing, booking, text,
     media, classification) records which source said it, when, and how
     sure we are.
   - Sources rank per facet. A disagreement that matters goes to review
     instead of being decided by whichever import ran last.
7. **Nothing is deleted; things change status.**
   - A cancelled activity stays, with `status: cancelled`.
   - Records the city expires stay, because we are the archive.
   - Users see what changed: "time changed from 20:00 to 21:00".
8. **Vocabularies are open.**
   - Kinds, place kinds and notice kinds are dotted codes (`music.concert`)
     in a taxonomy the API serves.
   - Codes are never reused or renamed, only deprecated with a
     replacement.
   - Clients must handle an unknown code by falling back to its parent
     (`music`), then to `other`. So adding a kind never breaks an app
     already installed.
9. **The API is versioned in the path and only ever grows within a
   version.**
   - `/agenda/v1` gains fields, values and routes. It never loses,
     renames or retypes them.
   - Clients ignore what they do not know.
   - Breaking changes go to `/v2`, and `v1` keeps answering for at least a
     year after.
10. **Writes are authenticated.**
    - The gateway has none today. The agenda's writes (import, update,
      review) take a bearer token from the environment from the first
      release.
    - An open write route on a service holding the editorial archive is not
      a guard against accidents; it is the accident.
11. **Images are copied, not linked, and their URLs never change.**
    - The city's images expire with its records.
    - Every image is fetched into canopus's own media service, in a few
      widths, with its credit kept beside it.
    - Its id is its content hash, so a URL is immutable and caches forever.
12. **Offers store the seller's own URL; affiliate links are applied when
    serving.**
    - A partner's tracking parameters or wrapper live in one place, the
      affiliate programmes registry.
    - Joining, leaving or changing a programme is one configuration change,
      not a rewrite of stored offers.
    - Every link that pays says so in the API (`affiliate: true`), and the
      app labels it.

## Principles for the data readers get

- **As much as is true, labelled with how we know it.** Show the full
  programme, every price we can find, and every place to buy. Say when it
  was checked and by whom it was said.
- **Absent means unknown.** A missing price is "unknown", never "free".
  `free` is a fact with its own source.
- **Official beats reported, and recent beats old, per facet.** A seller
  knows a price better than the city does. The city knows a time better
  than a newspaper does.
- **A reader's saved things never break.** Ids are permanent, merges
  redirect, cancellations are shown rather than removed.
- **The past stays, greyed.** A session that has ended, an event that is
  over and an edition from last year are all still shown, drawn greyed with
  their dates, and never offered for sale. Between editions a series shows
  its last one, so Pilar is in the app all year (api.md, "Time state").

## Clients

- The app keeps a 30-day feed with its ETag, the way it keeps stop
  listings, and applies the change feed on top.
- It works out the nearest stops itself from a place's point; the agenda
  knows nothing about transport.
- The tab is called **Agenda** in both languages: short enough for a tab
  bar, and it covers fiestas, exhibitions and concerts alike, where
  *Actividades* reads as workshops. Its glyph is Phosphor's `calendar-star`.
- The tab, top to bottom:
  1. **Highlights** (*Destacados*);
  2. a day strip shared with the billboard;
  3. kind chips;
  4. the day's list in time-of-day blocks;
  5. museums and exhibitions.
- An edition's page:
  - day tabs with counts;
  - its spaces;
  - Eat & drink;
  - Practical;
  - a map.
- An activity's page:
  - every session;
  - every price and seller;
  - how to get there, with the day's closures;
  - when it was checked;
  - the source's credit.

## Phases

Two editions set the first deadlines:

- **Navidad 2026,** which starts at the end of November and runs to 6
  January. The city lists 347 of its events today, 330 with a map point,
  most of them in December.
- **Pilar 2026,** which is over. It is loaded as an ended edition from its
  official PDF, so the app has the city's biggest edition, greyed, from day
  one.

The city deletes a record once its event ends. Every day before the archive
runs loses Navidad's first days for good, the way Pilar 2026's records were
lost. So phase 0 comes first and cannot wait for the rest.

0. **This week: archive the city's feed.**
   - A daily job in canopus fetches the whole agenda (all pages, sorted,
     `srsname=wgs84`).
   - It stores every record as received in `raw_records`, with its images,
     never deleting.
   - This needs no model, no API and no app: it is the input every later
     phase replays.
1. **The service, the city pipeline and the read API,** with the media
   service. The model and routes ship whole, but only what Navidad needs is
   filled in:
   - events, occurrences and places;
   - the city import, linked to editions by programme and portal;
   - the feed, highlights, events, schedule, places and taxonomy routes.
2. **The editorial store and bulk import, with the two editions in it:**
   - **Navidad 2026:** the series and edition by hand, its 347 city events
     linked, its programmes (the lights, the Belén, Sweet Palace, the
     markets) written as editorial;
   - **Pilar 2026:** the PDF parser's drafts, checked and published as an
     ended edition, with its venue directory as places;
   - **Only the latest edition of each series, for now.** Older editions
     (Pilar 2025, Navidad 2025) are not imported. The archive grows from
     here on.
   - **The series we know the calendar of,** with their rules and
     predicted next dates (research.md, "Predicted dates"). Readers see
     them as "Coming up", with a countdown, before anything is
     announced.
3. **The app's Agenda tab and pages,** on both platforms, behind a remote
   flag, `agenda_enabled`, shipped off like the others. It is released as
   soon as it is built, and turned on when the data is checked.
   - **Navidad is the target,** live before its busiest weeks: the Puente
     de la Constitución (6–8 December), then 20 December to 6 January.
   - **Scope:**
     - Highlights, with past editions greyed and their next expected
       date;
     - Coming up: every series' next expected date, with days left;
     - the day list;
     - an edition's page, with day tabs and past sessions greyed;
     - an activity's page, with how to get there;
     - museums.
   - **Everything else in this spec waits** for after Navidad.
4. **Prices and tickets:** Ticketmaster and Entradium first, with the
   review queue and the affiliate programmes each seller offers.
5. **The hand-written series,** in calendar order:
   - Semana Santa;
   - Champions Burger;
   - Fiestas del Pilar 2027, from its PDF and the city's live feed;
   - Halloween.
6. **Vendors, services and mobility** for Pilar 2027.
7. **A full admin UI:** editing an edition's programme, the review queue
   and revisions in one place.

## Decided

- **Affiliate links: yes,** wherever a seller has a programme. They are
  applied at serve time and labelled in the app.
- **Content lives in canopus.** Editorial data goes in MongoDB with
  revisions; configuration goes in git (content.md).
- **The tab is "Agenda".**
- **Images are served by canopus's own media service** (media.md).

## Open decisions

- **English for hand-written content.** The city's text is Spanish only.
- **The rest of the tab's wording** needs approving: the Expo app's language
  files have nothing for any of this.
- **Whether a CDN sits in front of the gateway.** Cloudflare on the API's
  domain caches the immutable image URLs and the feed at the edge for free.
  Without it, the host serves every image itself.
- **Where the media bytes live** (media.md): GridFS in the existing MongoDB,
  or a volume on the host. This depends on the MongoDB plan's storage.
