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
| `updateAll`    | —                       | Clears the cache and re-scrapes every cinema   |

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

## Environment

| Variable               | Required | Description                   |
| ---------------------- | -------- | ----------------------------- |
| `MONGODB_URI`          | yes      | Connection string (db `zine`) |
| `THE_MOVIE_DB_API_KEY` | yes      | TheMovieDB v3 API key         |

Both are validated at boot; the service refuses to start without them.

## Development

```bash
pnpm start:dev     # watch mode
pnpm build         # nest build
```
