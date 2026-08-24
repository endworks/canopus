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
| `movies`       | —                       | Every persisted film                           |
| `cached`       | —                       | Current cache keys                             |
| `updateAll`    | —                       | Clears the cache and re-scrapes every cinema   |

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
