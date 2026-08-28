# @canopus/weather

Current conditions, a short forecast and the official warnings in force for one
place, from whichever provider the caller has a key for.

By default the service holds no API key of its own. Every request carries the
caller's — the bot's, the app's — in a header, and the quota it spends is
theirs. What the service adds is the part neither of them should each be doing:
one shape for the answer, one cache in front of the provider, and an honest
account of which services the answer came from.

The one exception is a credential a caller cannot physically carry. Apple's
WeatherKit wants a token signed with an Apple Developer key, and an app that
shipped that key would be handing it to anyone who unzipped the bundle — so a
deployment meaning to serve its own app configures the key here instead. See
[Configuration](#configuration). Nothing sensitive lives in this repository
either way.

## Endpoint

```
GET /weather?location=Zaragoza
GET /weather?lat=41.6488&lon=-0.8891&lang=es&units=metric
GET /weather/providers
```

| Header                 | Required  | Meaning                                               |
| ---------------------- | --------- | ----------------------------------------------------- |
| `X-Weather-Api-Key`    | usually   | The caller's own key or token. See `managed` below    |
| `X-Weather-Client-Key` | sometimes | Leave to spend this deployment's own credential       |
| `X-Weather-Provider`   | no        | Which provider to ask. Defaults to `openweather`      |
| `X-Weather-Uv`         | no        | Set to include the UV index                           |
| `X-Weather-Alerts`     | no        | Set to include the official warnings in force         |
| `X-Weather-Forecast`   | no        | Set to `false`, `0` or `no` to skip it. On by default |

`GET /weather/providers` lists what this build can answer from, and what each
one carries: `geocoding`, its own `alerts`, its own `uv`, and `managed` — which
says whether this deployment holds a credential for it, so a caller may send no
`X-Weather-Api-Key` at all. A key the caller does send is always preferred, so
their quota is spent rather than the deployment's.

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
| `safety`   | Least band of warning worth returning. Absent returns them all      |
| `area`     | Keep only warnings whose region matches. Ignores case and accents   |
| `country`  | ISO alpha-2 the coordinates stand in. Rarely needed — see below     |

`country` exists because warnings are scoped by one and a coordinate does not
carry one. It is seldom worth sending: asking by `location` works it out from
the geocoded place, and asking by `lat`/`lon` falls back to the region atlas,
which holds the outlines of every warning region in the thirty-five countries
MeteoAlarm covers and is therefore a map of those countries too. Send it for
somewhere outside them, or to overrule a point the atlas places on the wrong
side of a border.

Getting this right matters more for Apple than it looks. WeatherKit returns no
warnings **at all** unless the request names a country, and it does not say so
— the call succeeds, the `weatherAlerts` dataset is simply absent, and the
reading is indistinguishable from a place where nothing is in force. Apple also
does no geocoding, so before the atlas was asked, every `lat`/`lon` question
put to Apple came back with no warnings whatever the weather was doing.

The parameter that carries it is `country`, which is not what Apple's own REST
documentation calls it. That says `countryCode`, and `countryCode` is ignored
in the same silent way.

`location` works for every provider, including the ones that cannot geocode.
A provider that can answers for itself, so the place it names and the reading
it gives come from one source. Apple cannot — WeatherKit answers the weather at
a point and nothing else — so the name is resolved by Open-Meteo's keyless
geocoder instead, and credited to it rather than to the provider.

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

The region atlas is not cached but loaded — once, on the first request that
needs it, and held for the life of the process. It is a map, not a reading.

## Attribution

Every response carries an `attribution` array — one entry per source, listing
only what actually came back:

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

### What a source requires shown

`name` and `url` are the credit most sources ask for. Three ask for more, and
because getting it wrong is a licence breach rather than a style slip, the
requirement travels on the wire instead of living in whichever client
remembered to hard-code it:

| Field        | What it is                                                  |
| ------------ | ----------------------------------------------------------- |
| `notice`     | The exact words to draw, linked to `url`, instead of `name` |
| `disclaimer` | A statement to publish alongside, wherever caveats go       |
| `logo`       | A mark to draw, where words alone will not do               |

- **Open-Meteo** asks for `Weather data by Open-Meteo.com` beside the data,
  linked to `url`. Its licence names that string and no mark, so there is no
  `logo` to draw.
- **Ayuntamiento de Zaragoza** asks, under Ley 37/2007, for three things: the
  citation `Origen de los datos: Ayuntamiento de Zaragoza`, which is `notice`;
  a statement that the city neither sponsors nor endorses the reuse; and the
  date the reused data was last updated. The last two share `disclaimer` —
  `Datos actualizados el 28/8/26, 11:00. El Ayuntamiento de Zaragoza no
participa, patrocina ni apoya esta reutilización de sus datos.` — because
  they are one sentence a client draws in one place, and adding a field for a
  date only one source in five needs would put an empty key on every other
  attribution on the wire. The date is the hour the nearest station reported,
  which is why this `disclaimer` is composed per reading rather than fixed on
  the source. It is deliberately not `lastUpdated`: that is the weather
  observation's time, from whichever provider answered the weather, on a
  different clock and often hours from the station's.
- **MeteoAlarm** asks for the national met office that issued a warning to be
  named rather than the aggregator that carried it, so `notice` is AEMET rather
  than MeteoAlarm; for the time each warning was issued, which is `issued` on
  the alert; for a link back to meteoalarm.org, which is `url`; and for every
  redistributor to publish its wording about the delay between a copy of its
  warnings and the live site, which is `disclaimer`. That last is also why
  `TTL.alerts` is five minutes: their terms cap the delay at ten.
- **Apple** asks for the Apple Weather wordmark, served per language, in `logo`.
- **OpenWeather** asks for its own mark, from the free plan up, in the visible
  part of the application rather than on a legal page — also `logo`, and only
  where `WEATHER_ASSETS_URL` says where this deployment serves it.

A `notice` is not a translation target, which is the part that looks like a bug.
A licence names a string, so the string is what satisfies it: Open-Meteo's stays
English in a Spanish client and Zaragoza's stays Spanish in an English one,
because a translated credit names an entity the terms have never heard of. The
credits that do vary by language vary on their own — MeteoAlarm's is the met
office's own name, read out of whichever CAP block matched, and Apple's is
artwork fetched per language.

Only `logo.light` is promised. Apple serves a light wordmark, a dark one and a
square mark; OpenWeather publishes one master logo, and its brand rules forbid
recolouring it or moving its symbol, so no dark variant is derived. A client
with only a light mark and a dark surface owes it a light plate rather than a
tint.

### Why it is an array

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

**Europe only.** The 38 countries EUMETNET publishes for. Anywhere else has no
feed to ask, and comes back with no `alerts` field at all.

### Narrowing to the place

The feed publishes one document per country and scopes each warning by a region
code with no geometry attached, so placing a warning takes a map the feed does
not ship. `src/data/meteoalarm-regions.json` is that map — 2,003 regions, built
by `pnpm build:regions` from the public MIT-licensed atlas in the [`meteoalarm`
Python package](https://github.com/NiklasJordan/meteoalarm), reduced from 31 MB
to 2 by keeping outer rings only at two decimals. A cell is eleven kilometres
wide and the atlas is accurate to one, so it is an order of magnitude finer than
the question it answers.

The cell's corners are tested along with its middle, and holes in a region are
dropped rather than cut out. Both over-include rather than under-include, which
for a warning is the direction it is safe to be wrong in.

`alertScope` says which of two things happened:

| `alertScope` | Meaning                                                         |
| ------------ | --------------------------------------------------------------- |
| `area`       | The cell was placed, and only the warnings covering it are here |
| `country`    | It could not be placed, and everything the country has is here  |

It is reported rather than left to be inferred because a short list means two
very different things under the two, and the wrong reading of it is reassurance.
The `country` case is the honest answer for a feed the atlas cannot speak to:
the atlas is drawn in `EMMA_ID`, and France and Romania scope by `NUTS3`,
Ireland by `FIPS`, Norway and Sweden by nothing at all.

The scheme travels with every code in `regions`, and the match is on both. Four
of France's `NUTS3` departments are spelled exactly like `EMMA_ID` regions
elsewhere in the atlas, so matching the string alone narrowed Bordeaux to no
warnings at all and called it an area with none in it.

### Narrowing by hand

`safety` keeps only the warnings at or above a band, named as either a colour or
the CAP severity beside it — `orange` and `severe` are the same floor. It earns
its place: of the 22 warnings in force over Zaragoza on an August afternoon, 21
were green, which is the band AEMET publishes to say a hazard is _not_ expected.

Where the two names disagree, the colour wins. They do disagree across the feed:
Spain files yellow as `Moderate` and Germany files it as `Minor`, and the colour
is the one MeteoAlarm normalises across its members and draws its maps in.

`area` keeps only the warnings whose region matches a string, ignoring case and
accents — as a substring of the names in `areas`, or exactly against one of the
codes in `regions`. It works in every country, including the ones the atlas
cannot place, which is the point of having it as well as the atlas.

Both narrow a list already fetched and cached whole, so asking for only the red
warnings in one valley costs the same single national call as asking for all of
them.

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

## Configuration

Everything sensitive comes from the environment. There is no key, certificate or
`.p8` in this repository, and there is not meant to be one.

| Variable                     | Meaning                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `WEATHERKIT_TEAM_ID`         | The 10-character Apple Developer team identifier                            |
| `WEATHERKIT_SERVICE_ID`      | The Services ID registered for WeatherKit                                   |
| `WEATHERKIT_KEY_ID`          | The 10-character identifier of the WeatherKit key                           |
| `WEATHERKIT_PRIVATE_KEY`     | The `.p8` itself, base64-encoded                                            |
| `WEATHER_CLIENT_KEY_VERSION` | Bump to rotate the derived client key                                       |
| `WEATHER_CLIENT_KEYS`        | Optional: your own keys, instead of the derived one                         |
| `WEATHER_ASSETS_URL`         | Where the gateway serves attribution marks — `https://api.end.works/assets` |

All four of the WeatherKit variables, or none. A deployment setting three of them is misconfigured rather
than opted out, and the service refuses to start rather than answering 401 to
every Apple request for a reason no log explains. Set none and `apple` reports
`managed: false`, callers bring their own tokens, and nothing else changes.

### Who may spend it

A credential the deployment pays for, behind a URL anyone can reach, is an open
tap — WeatherKit's free tier is 500,000 calls a month, and there is a bill after
it. So a configured credential always has a client key in front of it, and the
service refuses to start if it somehow does not.

That key needs no new secret. It is an HMAC of the WeatherKit private key you
already configured, so it is derived rather than stored:

```
WEATHERKIT_PRIVATE_KEY="$(op read 'op://end.works/Apple WeatherKit/private key')" \
  pnpm --filter @canopus/weather client-key
```

Print it once, put it in the app, and there is nothing extra in the vault. Bump
`WEATHER_CLIENT_KEY_VERSION` to rotate it — no new Apple key, no new field.

The three identifiers beside the key are **not** usable for this, and it is
worth saying why, because reaching for one is the obvious idea. The Team ID is
in the `embedded.mobileprovision` of every build. The Service ID is public the
moment it is used for Sign in with Apple, and guessable regardless. The Key ID
is the middle of the `.p8`'s own filename. A gate whose secret ships inside the
thing it guards is not a gate. The private key is the one genuine secret in the
set, and HMAC is one-way, so the derived key reveals nothing about it.

Set `WEATHER_CLIENT_KEYS` to take this over with your own comma-separated list —
useful for several clients with separate keys, or for rotating with an overlap.
It replaces the derived key rather than adding to it.

The check applies **only** to the managed path. A caller sending their own
`X-Weather-Api-Key` is spending their own quota and needs no leave from us; a
caller sending none, against a provider whose credential we hold, must send an
`X-Weather-Client-Key` we recognise or be turned away before anything is
fetched. Keys are compared in constant time and the list takes several, so one
can be rotated without a gap: add the new key, ship the clients, drop the old.

It is a shared secret, not an identity — enough that the endpoint is not an open
proxy, and not a substitute for real authentication if this ever serves more
than its own apps. It is also not a rate limit: a leaked key still spends the
quota until it is rotated.

The key is stored **base64-encoded** because a `.p8` is a PEM block, and its
newlines do not survive the trip from a secret store through a CI environment,
an SSH hop and `docker run -e` intact:

```
base64 -i AuthKey_FGHIJ67890.p8 | pbcopy
```

The deploy workflow reads all four from 1Password, as every other secret here is
read, and passes them to the container. It expects an item named
`Apple WeatherKit` in the `end.works` vault with the fields `team id`,
`service id`, `key id` and `private key`. Nothing else — the client key is
derived from the last of those.

Running it locally, put them in the environment `docker compose` inherits, or
export them before `pnpm start:dev`. Never in a file this repository tracks.

## Adding a provider

One class implementing `WeatherProvider` (`src/providers/weather-provider.ts`)
and one line in `IMPLEMENTATIONS` (`src/providers/registry.ts`). The registry
keys itself by `info.id`, which is what `X-Weather-Provider` names, so nothing
else — not the service, not the controller, not the gateway — carries a
provider's name.
