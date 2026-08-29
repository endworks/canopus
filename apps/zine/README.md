# @canopus/zine

Cinema microservice. Scrapes billboards and showtimes from
[reservaentradas.com](https://www.reservaentradas.com), enriches each film with
metadata from [TheMovieDB](https://www.themoviedb.org), persists both to
MongoDB, and serves the result over TCP to the Canopus gateway.

## Message patterns

Exposed as `ZINE_PATTERNS` in `@canopus/shared`:

| Pattern        | Payload                 | Returns                                        |
| -------------- | ----------------------- | ---------------------------------------------- |
| `cinemas`      | `{ location?: string }` | Cinemas, optionally filtered (comma-separated) |
| `cinema`       | `{ id: string }`        | Cinema with showtimes and enriched films       |
| `cinema/basic` | `{ id: string }`        | Cinema with showtimes only (no TheMovieDB)     |
| `movies`       | `{ location?: string }` | Films on a billboard, optionally filtered      |
| `cached`       | —                       | Current cache keys                             |
| `prune`        | —                       | Deletes what the catalogue has dropped         |
| `updateAll`    | `{ location?: string }` | Re-scrapes, then warms one city (def. Zaragoza) |

## Identity

A **film** is a TheMovieDB id. The sites print the same title differently —
`Cuenta atrás` and `Cuentra atrás`, `La La Land` and `La ciudad de las
estrellas (La La Land)` — so a title cannot identify one. A film TheMovieDB
doesn't know is left off the billboard: it has no id to be keyed by and no
metadata to show. `cinema/basic` is the exception, and is keyed by scraped
title; it never writes those ids to the database.

A **venue** is placed by its postal code, which is the only field either site
publishes that locates one. Names don't — there is a Cine Goya in Maella, one
in Mequinenza and one in Caspe — and neither does the region, which
reservaentradas takes from the URL and SensaCine from whichever index listed
the venue, so all three read as Zaragoza. The two sites disagree on the code
often enough that an identical name in the same town counts as a match too.

A venue whose page failed to load has no code, and nothing weaker is used in
its place: it stays unmatched, and appears twice until the next run reads it.
A duplicate is the cheaper mistake, because the merged-away listing is deleted.

## Pruning

`updateAll` saves the whole national catalogue, but only refreshes the
billboards of the city it is given, defaulting to Zaragoza — every venue is one
scrape plus a TheMovieDB lookup per film. A venue outside that city is stored
with no films, so it lists nothing until a run names its city.

`updateAll` only ever writes: a venue that closes, or a film that leaves every
billboard, stays in the database. `prune` is the other half, and is deliberately
a separate call so a refresh never deletes on its own. It is a `POST`: it
removes documents, and nothing that merely follows links should reach it.

Nothing carries a timestamp, so staleness is reachability rather than age — a
venue neither site lists any more, then a film no remaining venue is showing.
That makes a failed scrape look exactly like a closed cinema, so the whole run
is skipped unless every source returned a catalogue; `pruned: false` and a
`reason` say so. Showtimes are dropped once their date has passed, and a film
left with none drops off that cinema's billboard.

## Environment

| Variable               | Required | Description                   |
| ---------------------- | -------- | ----------------------------- |
| `MONGODB_URI`          | yes      | Connection string (db `zine`) |
| `THE_MOVIE_DB_API_KEY` | yes      | TheMovieDB v3 API key         |
| `GOOGLE_MAPS_API_KEY`  | no       | Geocoding, to place venues on a map |

Both are validated at boot; the service refuses to start without them.

## Development

```bash
pnpm start:dev     # watch mode
pnpm build         # nest build
```
