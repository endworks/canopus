# Zaragoza search

`GET /zgz/search?q=…` is one search box for the city: what is on and how to
get there. The gateway asks the two services that hold something findable at
once, merges what they answer and pages through it.

| Service | Hit types |
|---|---|
| `zaragoza` | `bus-line`, `tram-line`, `bus-stop`, `tram-stop`, `bizi-station` |
| `agenda` | `series`, `event`, `activity`, `venue` |

Cinemas are not in it: zine serves more than one city and keeps its own
listings.

## Parameters

| Parameter | |
|---|---|
| `q` | Required, at most 80 characters. Fewer than two letters and not a number answers nothing. |
| `types` | Comma-separated hit types; absent means all. |
| `near` | `longitude,latitude`. Hits within a kilometre or so rise by up to a quarter. |
| `lang` | `es` (default) or `en`, for titles that have both. |
| `limit` | A page, 1 to 50, 20 by default. |
| `offset` | Where the page starts: the last page's `meta.next`. |

```jsonc
{
  "data": [{ "type": "bus-stop", "id": "720", "title": "Plaza de España",
             "subtitle": "Parada 720 · 22, 32, 40, N1", "coordinates": [-0.88, 41.65],
             "service": "zaragoza", "score": 76 }],
  "meta": { "generatedAt": "…", "partial": [], "offset": 0, "limit": 20,
            "total": 42, "next": 20 }
}
```

`meta.next` is `null` on the last page. `meta.partial` names a service that
failed or took longer than 2.5 s and was left out. An activity whose other
nights at the same place were folded into it carries `more`, how many.

## Matching

Both sides of a comparison are folded the same way (`@canopus/shared`,
`search.ts`): lower case, accents and ñ off, punctuation to spaces, and the
city's abbreviations written out — `Pza.` is `plaza`, `Av.` and `Avda.` are
`avenida`, `C/` is `calle`, `Pte.` is `puente`, and so on. Filler words (`de`,
`del`, `la`, `el`, `y`, `the`, `of`, what is left of `nº`) are dropped from the
query unless they are all it has.

Every word of the query must meet a word of the hit, in some field:

| How | Worth |
|---|---|
| The whole word | 3 |
| The start of it ("pil" for "pilar") | 2 |
| One letter wrong, missing, extra or swapped, in a word of four letters or more ("pilr") | 1 |

A word only inside another ("lar" in "pilar") does not count. A number must
be whole, except in a field of codes — a stop's number, a line's — where it
may be the start ("72" on its way to 720).

Each word scores by its best field, times the field's weight. A field whose
meaningful words are exactly the query's adds 10 × its weight; one that
begins with them, 5 ×. So "plaza españa" is the stop "Plaza de España"
before it is every event that mentions the square.

| Hit | Fields and weights | Then |
|---|---|---|
| Line | code 3, name 1 | code typed whole: +60 bus, +58 tram |
| Stop, dock | name 3, number 2, lines 1 | number typed whole: +50 bus, +45 tram, +40 Bizi |
| Series | Spanish name 4, English name 3 | ×1.2 |
| Event, activity | title 3, tags 1, venue 1 | by time (below); edition ×1.3; search-only ×0.6 |
| Venue | name 3, aliases 2, street 1 | |

A tram stop answers to the numbers on its platforms (1301, 1302), not the
place code it is stored under (1300).

Time, for events and activities: on now ×1.3, starting within a week ×1.2,
within a month ×1, within three months ×0.85, later ×0.7, ended ×0.4. Ended
more than thirty days ago is not searched at all.

## Order

By score; then, for a tie, by type — line, bus stop, tram stop, Bizi, series,
event, activity, venue, which is what a bare number shared by several
networks means in that order — then the soonest date, then title, then id.
The order is total, so a page never repeats a hit another page showed.

## Caching and pages

The gateway ranks a query once, up to 200 hits, and keeps the list a minute,
keyed by the folded query, the types, the language and `near` rounded to
about a hundred metres. Every page is a slice of that list, so scrolling asks
nothing of the services. An answer with a service missing is not kept. The
response says `Cache-Control: public, max-age=60`.

The agenda scores from the whole agenda held in memory, read again every ten
minutes; the stops and lines are each network's own cached lists.
