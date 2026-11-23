# Agenda — editorial content

The big dates mostly have no open data, so people write them, and accuracy
is the point. Two kinds of hand-written material, kept in two places:

| What | Where | Why there |
|---|---|---|
| **Configuration:** the taxonomy, the source registry, the filters, the mappings, the affiliate programmes | `content/config/` in canopus, as YAML | It behaves like code: it changes what every record becomes. It is reviewed in a pull request, checked against a schema in CI, and imported by the deploy (`POST /agenda/v1/admin/config/import`) |
| **Editorial data:** series, editions, programmes, activities, places, agents, vendors, notices, corrections | MongoDB, in the `editorial_*` collections (data-model.md), through the admin API | It changes by the hour during an edition. A time that moves at 18:00 must be fixed by 18:05, from a phone, without a pull request and a deploy |

```
content/config/
  sources.yml        # the source registry (ingestion.md)
  taxonomy.yml       # every code, its parent, labels, icon, deprecations
  filters.yml        # visibility rules
  affiliates.yml     # affiliate programmes: seller, hosts, parameters or wrapper
  mappings/
    city-categories.yml     # the city's labels → our kinds
    city-programmes.yml     # the city's programmes and portals → editions
  schema/*.json
```

## Why editorial data is in MongoDB, not git

Git would give review, history and diffs for free, and that is what an
editorial store has to replace. The editorial store does it as follows:

- **History.** Every write records a revision: the whole document before
  and after, who, when and why. Any revision can be reverted.
- **Review.** Documents are `draft`, then `ready`, then `published`. Only
  `published` reaches readers, and publishing runs the same validation as
  every import.
- **Backup and a way out.** A nightly export of every editorial collection
  to one JSON archive, kept in the media store with 90 days of history. The
  archive is also the format a future admin UI or a migration reads.
- **The archive.** The editorial store and `raw_records` together are what
  cannot be rebuilt from anywhere else. They are what the MongoDB backups
  exist for.

It is worth it because the alternative fails in the week that matters most.
During the fiestas, programmes change daily, the person fixing them is often
away from a desk, and a pull request with a deploy per corrected time is
the bottleneck. Configuration stays in git because a change there rewrites
thousands of records, and that should be reviewed.

## Writing it

- **One thing at a time:** the admin API, through a minimal admin page
  first and the full admin UI later (README, phases).
- **A whole programme at once:** the bulk format below.
  - It is YAML or JSON, posted to `POST /agenda/v1/admin/editorial/bulk`.
  - Everything is written as `draft`, and a report says what each entry
    became.
  - The PDF parser writes this format, so a printed programme becomes
    drafts a person checks and publishes.

## Identity in editorial data

- **Editorial documents have a `key`:** a readable handle such as
  `pilar-2026/espacio-zity`, unique per collection. References between
  editorial documents use keys, never database ids.
- **The pipeline maps each key to a published id** in `identities`, as
  source `editorial`. A key is permanent once published: fix the title,
  never the key.
- **To attach to a record from another source,** refer to it by its source
  key: `{ source: city.agenda, ref: '316583' }`.

## The bulk format

```yaml
# POST /agenda/v1/admin/editorial/bulk — an edition and everything in it
key: pilar-2026
series: fiestas-del-pilar
title: { es: Fiestas del Pilar 2026, en: Fiestas del Pilar 2026 }
officialSpan: { startDate: 2026-10-10, endDate: 2026-10-18 }
status: programme-complete
dayStartsAt: "06:00"
poster: { image: posters/pilar-2026.jpg, credit: "La ciudad en ofrenda — Jesana Motilva Santaliestra" }
guests: [{ es: "Venezuela, país invitado" }]
info: { phones: ["010", "+34 976 72 12 34"], places: [oficina-turismo-plaza-pilar, torreon-zuda] }
links:
  - { kind: official, url: https://www.zaragoza.es/sede/portal/cultura/fiestas-pilar/ }
  - { kind: programme, url: https://www.zaragoza.es/…/programa-pilar26.pdf }
verified: { url: https://www.zaragoza.es/…/programa-pilar26.pdf, at: 2026-10-01 }

places:                                   # temporary ones; permanent ones are editorial places of their own
  - key: esc-fuente-goya
    name: { es: Escenario Ámbar Fuente de Goya }
    aliases: [Esc. Ambar Fuente de Goya, Escenario Ambar Fuente de Goya (Plaza del Pilar)]
    kinds: [stage.temporary]
    parent: plaza-del-pilar
    geo: [-0.8779, 41.6560]

programmes:
  - key: recinto-ferial
    title: { es: Recinto Ferial Valdespartera }
    kinds: [fair.funfair]
    places: [recinto-ferial-valdespartera]
    span: { startDate: 2026-10-09, endDate: 2026-10-25 }   # past the fiestas, as it does
    hours:
      exceptions:
        - { date: 2026-10-09, ranges: [{ opens: "17:00", closes: "29:00" }] }
        - { date: 2026-10-10, ranges: [{ opens: "12:00", closes: "15:00" }, { opens: "17:00", closes: "29:00" }] }
        # …
    notices:
      - { kinds: [accessibility.relaxed], title: { es: Día sin ruido }, when: [{ starts: 2026-10-22T17:00, ends: 2026-10-22T20:00 }] }
      - { kinds: [discount], title: { es: "2x1 en atracciones" }, when: [{ starts: 2026-10-19, ends: 2026-10-22 }] }

  - key: espacio-zity
    title: { es: Espacio Zity }
    kinds: [music.concert]
    places: [recinto-ferial-valdespartera]
    offers: [{ id: general, name: { es: Entrada }, availability: unknown }]

activities:
  - key: houdini
    title: { es: "Houdini. Un musical mágico" }
    kinds: [stage.musical, family]
    places: [teatro-principal]
    sessions: ["2026-10-13 20:00", "2026-10-17 17:00", "2026-10-17 20:30"]
    offers:
      - id: general
        price: 22
        url: https://…
        seller: teatro-principal
        verified: { url: https://…, at: 2026-10-05 }

  - key: planeta-jurasico
    title: { es: Planeta Jurásico }
    kinds: [exhibition.immersive, family]
    places: [carpa-blanca-valdespartera]
    windows:
      - { date: 2026-10-14, from: "17:00", to: "22:30", every: 30 }
    links: [{ kind: tickets, url: https://planetajurasico.com }]

  - key: desfile-pregon-interpenas
    parent: pregon
    title: { es: Desfile del Pregón (Interpeñas) }
    kinds: [tradition.parade]
    sessions: ["2026-10-10 17:00"]
    route:
      - { name: Plaza de España, role: start }
      - { name: Coso }
      - { name: Don Jaime }
      - { name: Plaza del Pilar }
      - { name: Puente de Piedra }
      - { name: Estación del Norte, role: end }

  - key: fuegos-16
    title: { es: Fuegos artificiales }
    kinds: [festivity.fireworks]
    places: [recinto-ferial-valdespartera]
    sessions: [{ at: "2026-10-16 22:15" }]

vendors:
  - programme: las-food-trucks
    agent: el-bueno-el-feo-y-el-malo      # an editorial agent's key
    pitch: { es: Junto al escenario }
    offerings:
      - { name: { es: Smash doble }, price: 12, dietary: [gluten-free], featured: true }

mobility:
  - kinds: [mobility.street-closure]
    title: { es: Cortes por la Ofrenda de Flores }
    when: [{ starts: 2026-10-12T06:00, ends: 2026-10-12T23:00 }]
    lines: ["bus:21", "bus:35", "tram:L1"]
    geometry: geo/pilar-2026-ofrenda.geojson

linkCity:                                 # the city's records that belong here
  portals: [fiestas-pilar]
  programmes: ["Fiestas del Pilar 2026"]
```

The shorthands expand to occurrences:

| Shorthand | Becomes |
|---|---|
| `sessions` | Sessions. A bare string is an exact local time; `{ date }` alone is day precision; `{ at, precision: approximate }` |
| `runs` | Runs: `{ from, to, hours? }` |
| `windows` | Windows |
| `schedule.rrule` | Anything regular |

## Corrections on other sources' records

```yaml
# editorial_overrides, as bulk
- target: { source: city.agenda, ref: "316583" }
  set:
    kinds: [music.tribute]
    parent: navidad-2026/auditorio
  reason: "'Otras' in the city's data"
  by: ender
  at: 2026-11-23

- target: { source: city.agenda, ref: "311526" }
  set: { visibility: hidden }
  reason: "Lugar por determinar; duplicate of 311530"

- target: { source: city.agenda, ref: "312001" }
  mergeInto: { content: pilar-2026/houdini }   # identity decision: these are one event
```

A review resolved through the admin route becomes one of these overrides,
with a revision. Every decision a person made is therefore recorded, and
replaying from raw data reaches the same result.

## Checks

**In CI, on `content/config/`:**

- every file matches its schema;
- every code a mapping or filter names is in the taxonomy;
- the import dry-runs against a copy of production's identities, and
  reports what it would reclassify, re-list or hide.

**On every editorial publish:**

- every key resolves;
- every code is in the taxonomy;
- every place has a point inside the bounding box, unless marked as outside
  the city;
- every hand-written price and every edition has `verified`.

**Daily:**

- **Freshness:** a warning for an edition starting within 30 days that has
  not been verified in the last 14.
- **Drafts:** a warning for drafts older than 7 days on an edition that
  starts within 30.
