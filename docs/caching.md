# Caching and compression

Most of what the API answers changes days apart, and the little that is live
is one stop's arrivals or one dock's bikes. Each route says which it is, with
`@CachePolicy` (`apps/gateway/src/cache-policy.ts`), and that one word sets
both what a client is told and what the gateway keeps.

| Kind | Routes | `Cache-Control` | The gateway keeps it |
|---|---|---|---|
| `static` | stop, dock and line lists, a line, places, series, an event, the taxonomy, cinema locations | `max-age=3600, stale-while-revalidate=86400` | 10 min |
| `daily` | the agenda's feed, highlights and a day's schedule, the billboard, duty chemists | `max-age=600, stale-while-revalidate=3600` | 2 min |
| `alerts` | bus and tram service alerts | `max-age=120, stale-while-revalidate=600` | 30 s |
| `live` | one stop's arrivals, one dock's bikes, the taxis | `max-age=10` | no: the services hold these 10–30 s |
| `none` | the `update` routes | `no-store` | no |
| (search) | `/zgz/search` | `max-age=60` | a minute, per query, pages cut from it (docs/search.md) |

What the gateway keeps is the answer to one URL, query included, and only a
200; it holds at most 300, the least recently used going first. A repeat
inside the window is answered without asking the service, so a phone
revalidating the stop list by its ETag costs neither a trip over TCP nor a
rebuild of 200 KB of JSON. Express still stamps the ETag and answers a
matching `If-None-Match` with a bodiless 304.

Every response over a kilobyte is compressed, gzip or Brotli as the client
asks: the agenda's month goes from about 520 KB to a tenth of that.

Underneath, each service keeps its own: the transit service its station and
line lists six hours and arrivals ten seconds, the agenda its whole index for
search ten minutes.

A new route takes a kind. A route without one sends no `Cache-Control` and is
never kept, which is right only for what writes or is personal (`/push`).
