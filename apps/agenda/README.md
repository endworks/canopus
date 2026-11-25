# @canopus/agenda

What is on in Zaragoza: the city's agenda, its big dates and its places,
served by the gateway under `/agenda/v1`. The specification is
[docs/agenda](../../docs/agenda/README.md).

## What it does

Checked every hour. It runs every six hours, edition or not, and backs off
to twelve and then twenty-four hours while the city keeps failing it: the
city began refusing this server on 25 November 2026, a day and a half into
hourly downloads of its whole list, and a refusal answered with the same
request on a timer is what gets a server blocked. A restart imports only if
a run is due. Edition mode (an edition on, or within three days of one) is
still worked out and reported by `admin/status`, but no longer changes how
often the city is asked. A run:

1. **Publishes the editorial layer:** the series, editions, places,
   programmes and activities people write, through the admin API. The
   first run moves the old seeds (`src/seeds/series.ts`) into the store,
   keeping their ids.
2. **Archives the city's agenda** into `raw_records`, never deleting, and
   publishes it as events, occurrences and places. Visibility rules apply,
   records are linked to the editions they fall within, and every editorial
   correction (`overrides`) is applied as its record is written, so a fix
   holds through every re-import.
3. **Handles records the city drops before their event ends:** the event
   leaves the lists (still found by id and search, with a note) and a review
   opens. If the record comes back, so does the event, and the review
   closes.
4. **Fetches the museums.**
5. **Derives** spans, current editions and the next expected dates.
6. **Once a day,** opens a review for any edition starting within 30 days
   whose facts nobody has checked in two weeks.

Failures go to Sentry. Every read answer carries `meta.lastImportAt`, and
`meta.stale` once the last good import is more than twelve hours old.

An editorial write to a published document is live at once. A correction on
a city record replays the archived records with it applied, in about twenty
seconds, without a fetch.

## Environment

| Variable | |
|---|---|
| `MONGODB_URI` | Required. Database `agenda`. |
| `AGENDA_IMPORT_ON_START` | `off` to skip the import 30 s after starting. |
| `SENTRY_DSN` | Optional. |

The gateway checks `AGENDA_ADMIN_TOKEN` on every `/agenda/v1/admin` route:
one token, or `name:token,name:token` so revisions say who. It comes from
1Password, `Canopus Agenda/admin token`. The routes are listed in
docs/agenda/api.md, "Admin".

## Develop

```bash
pnpm --filter @canopus/agenda test
pnpm --filter @canopus/agenda build
MONGODB_URI=mongodb://localhost:27017 pnpm --filter @canopus/agenda start:dev
```

## Not yet

These parts of the specification come in later phases:

- the media service: images are still the city's own URLs;
- an admin UI (the API is all there is for now);
- the change feed;
- the PDF import for an edition's programme;
- prices and tickets from sellers;
- vendors, notices and mobility.
