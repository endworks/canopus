# @canopus/weather

Current conditions and a short forecast for one place, from whichever provider
the caller has a key for.

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

| Header                | Required | Meaning                                                |
| --------------------- | -------- | ------------------------------------------------------ |
| `X-Weather-Api-Key`   | yes      | The caller's own key for the chosen provider            |
| `X-Weather-Provider`  | no       | Which provider to ask. Defaults to `openweather`        |
| `X-Weather-Uv`        | no       | Set to include the UV index, which costs a second party |

| Query      | Meaning                                                            |
| ---------- | ------------------------------------------------------------------ |
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

| Source        | Held for   | Because                                            |
| ------------- | ---------- | -------------------------------------------------- |
| Current       | 10 minutes | OpenWeather refreshes a station reading no faster   |
| Forecast      | 30 minutes | It is a model run, and its steps are 3 hours wide   |
| Air quality   | 1 hour     | Published hourly                                    |
| UV index      | 30 minutes | Hourly, though its "now" is interpolated within it  |
| Geocoding     | 7 days     | Place names do not move                             |

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
  { "name": "Open-Meteo", "url": "https://open-meteo.com/", "provides": ["uv"] }
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

## Adding a provider

One class implementing `WeatherProvider` (`src/providers/weather-provider.ts`)
and one line in `IMPLEMENTATIONS` (`src/providers/registry.ts`). The registry
keys itself by `info.id`, which is what `X-Weather-Provider` names, so nothing
else — not the service, not the controller, not the gateway — carries a
provider's name.
