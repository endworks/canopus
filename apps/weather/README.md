# @canopus/weather

Current conditions, a short forecast and the official warnings in force for one
place, from whichever provider the caller has a key for.

The service holds no API key of its own. Every request carries the caller's —
the bot's, the app's — in a header, and the quota it spends is theirs. What the
service adds is the part neither of them should each be doing: one shape for the
answer, one cache in front of the provider, and an honest account of which
services the answer came from.

## Endpoint

```
GET /weather?location=Zaragoza
GET /weather?lat=41.6488&lon=-0.8891&lang=es&units=metric
GET /weather/providers
```

| Header               | Required | Meaning                                                 |
| -------------------- | -------- | ------------------------------------------------------- |
| `X-Weather-Api-Key`  | yes      | The caller's own key for the chosen provider            |
| `X-Weather-Provider` | no       | Which provider to ask. Defaults to `openweather`        |
| `X-Weather-Uv`       | no       | Set to include the UV index, which costs a second party |
| `X-Weather-Alerts`   | no       | Set to include official warnings. Europe only           |
| `X-Weather-Forecast` | no       | Set to `false`, `0` or `no` to skip it. On by default   |

Any value but a plain refusal — `false`, `0`, `no` — turns a header on. `1`, `yes`
and a bare `X-Weather-Uv:` all mean the same thing, and refusing one on a
technicality helps nobody.

`X-Weather-Forecast` is the one row that is on until it is turned off: it is
what was always there, and a caller who has never heard of the header should
keep getting it. Turning it off also costs `current.high` and `current.low` —
they are read off the forecast steps, because OpenWeather's own `temp_min` and
`temp_max` on the current reading are the spread across reporting stations, a
different quantity that happens to share the name — so the range collapses to
the observed temperature rather than being invented from the wrong field.

| Query      | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `location` | Place name, resolved by the provider. Ignored when lat/lon are sent |
| `lat`      | Latitude, sent together with `lon`                                  |
| `lon`      | Longitude, sent together with `lat`                                 |
| `lang`     | Language for the provider's descriptions. Defaults to `en`          |
| `units`    | `metric` (default), `imperial` or `standard`                        |

The provider's own refusals come back as themselves: a key it rejects is a 401,
a spent quota is a 429, a place it has never heard of is a 404. A caller who
supplied that key can act on every one of those, and collapsing them into a 500
would make this endpoint harder to use than calling the provider directly.

## Caching

Coordinates are rounded to one decimal — about eleven kilometres, so a whole
city is a cell or two — before anything is fetched, and the rounded pair is both
the cache key and what comes back in `location`. That is what makes the cache
worth having: every caller standing anywhere in town asks the same question, so
they share one upstream call instead of minting one each.

The key carries no trace of the API key. Two callers in the same cell are asking
the same question and the answer does not depend on whose quota paid for it, so
a warm cell costs the second caller nothing at all.

Each upstream call is cached for as long as its own source stands still, rather
than all of them for one compromise interval:

| Source      | Held for   | Because                                            |
| ----------- | ---------- | -------------------------------------------------- |
| Current     | 10 minutes | OpenWeather refreshes a station reading no faster  |
| Forecast    | 30 minutes | It is a model run, and its steps are 3 hours wide  |
| Air quality | 1 hour     | Published hourly                                   |
| UV index    | 30 minutes | Hourly, though its "now" is interpolated within it |
| Alerts      | 5 minutes  | An office upgrading orange to red means now        |
| Geocoding   | 7 days     | Place names do not move                            |

Warnings are the exception to the per-cell rule: MeteoAlarm publishes one feed
per country, so the cache key is the country and the language, and every caller
anywhere in Spain shares one call. They are held five minutes rather than ten
because a warning is the one thing here that is urgent by definition.

`lastUpdated` is the observation's own time rather than the moment it was
served, so a client running its own TTL over the response cannot stack its
staleness on top of ours.

## Attribution

Every response carries an `attribution` array — `{ name, url, provides }` per
source, listing only what actually came back:

```json
[
  {
    "name": "OpenWeather",
    "url": "https://openweathermap.org/",
    "provides": ["weather", "forecast", "airQuality", "geocoding"]
  },
  {
    "name": "Open-Meteo",
    "url": "https://open-meteo.com/",
    "provides": ["uv"]
  },
  {
    "name": "MeteoAlarm",
    "url": "https://meteoalarm.org/",
    "provides": ["alerts"]
  }
]
```

It is an array rather than one name because the UV index is not the weather
provider's. OpenWeather's free plan carries no UV at all — it moved to One Call
3.0, behind a card — and Open-Meteo answers it without a key of any kind. That
is a second service in an endpoint that otherwise has one, which is why the row
is opt-in: a caller who does not want a second party in the request simply does
not send `X-Weather-Uv`, and no Open-Meteo line appears.

The same rule applies downwards. A key whose plan does not carry air quality
loses that field and its credit, not the temperature; a second provider that is
down loses the UV row and its credit, not the reading.

MeteoAlarm is credited for an empty list too, unlike the fields above. "No
warnings are in force here" is a claim, and it is theirs rather than ours. The
case where nothing is owed is the feed not answering at all — a place outside
Europe, or a feed that is down — and that leaves `alerts` off the response
entirely rather than saying, on nobody's authority, that all is well.

## Warnings

`X-Weather-Alerts` adds the official warnings in force, most severe first, from
[MeteoAlarm](https://meteoalarm.org/) — EUMETNET's aggregator, which collects
what the national met offices issue as CAP and publishes it without a key. Each
warning names the office that issued it and links where that office publishes
it; MeteoAlarm's own colour band (`green`, `yellow`, `orange`, `red`) and the
phenomenon it files the warning under (`Wind`, `Rain`, `snow-ice`, …) are lifted
out of the CAP parameter list into `level` and `awareness`.

Two things a caller should know about the scope:

**Europe only.** The 38 countries EUMETNET publishes for. Anywhere else has no
feed to ask, and comes back with no `alerts` field at all.

**Country, not cell.** The feed scopes each warning by a region code and carries
no geometry — and the codes are not even the same kind of code from one country
to the next: Spain uses `EMMA_ID`, France `NUTS3`, Germany both plus its own
`WARNCELLID`. Narrowing to the eleven-kilometre cell would mean shipping a
region atlas and keeping it true. Every warning names the regions it covers in
`areas` instead, as the issuing office names them, and a caller who knows which
region it stands in can filter better than a lookup table would.

The feed is a rolling window several days wide, so most of what it carries has
already happened. What comes back is what is still in force: warnings whose
expiry has passed are dropped, and an office that updates a warning issues a new
message naming the one it replaces — both are in the feed, only the update comes
back. A warning with no expiry at all is kept, since some offices issue those
and an absent end is not a lapsed one.

Warnings are written in the language asked for where the office publishes it,
and in English otherwise — matched on the language alone, since the same feed
spells English `en-GB` in Spain and `en` in Germany. English is also what a
request that names no language gets.

## Adding a provider

One class implementing `WeatherProvider` (`src/providers/weather-provider.ts`)
and one line in `IMPLEMENTATIONS` (`src/providers/registry.ts`). The registry
keys itself by `info.id`, which is what `X-Weather-Provider` names, so nothing
else — not the service, not the controller, not the gateway — carries a
provider's name.
