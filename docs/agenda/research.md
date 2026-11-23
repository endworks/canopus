# Agenda — research

What the sources actually hold, measured in November 2026. These are the reasons behind the rules in [ingestion.md](ingestion.md) and the shapes in [data-model.md](data-model.md); re-measure before relying on the numbers.

## The city's event service

The city agenda keeps no history. Asked in November 2026, it held:

- no events from Pilar 2025, and only 12 tagged for Pilar 2026, which ended
  a month earlier;
- three from Christmas 2025.

Two consequences:

- **Archive.** This service keeps every edition and its programme after the
  city drops them. `source_records` are never pruned for an activity that
  belongs to an edition.
- **The big dates have to be written by hand,** or scraped from their own
  programmes. The city's feed carries only a fraction of them.

It also needs care:

- **Paging is unstable** without a sort: 500 a page returned 2,289 unique
  events of 2,967. Sort by id, and dedupe by id anyway.
- It **keeps finished events**: filter on `endDate` in the query.
- **Times are weekly patterns** (`openingHours`: day of week + start/end
  inside a date range). Expand them into occurrences.
- It has **no stable category**: `category`, `type`, `population`,
  `program` and `portales` all have to be read together.
- It is **Spanish only**, descriptions are HTML, price is on about a quarter
  of events, ticket links on very few.
- The data is **CC BY**: the app credits the Ayuntamiento wherever it shows
  city data (check the exact licence text before release).


The service does answer `srsname=wgs84` (plain longitude and latitude), `q=endDate=ge=…` (server-side filters: 2,967 → 2,111) and `fl=` (fields). A sort on an unknown property answers `400 PropertyNotFoundException`.

Of 2,266 dated events at the time: ~1,070 were courses and workshops, ~560 had already ended, ~100 were long-running non-exhibitions, ~15 were for one closed audience. About 520 remained worth listing, 145 of them in the next seven days; 97% of those had their own image, a quarter a price, very few a ticket link.

The city's facilities service lists 25 places under category *Museos*, with opening hours as free text.

## Fiestas del Pilar 2026

Read from the official PDF (60 pages, about 750 acts), the city's expired
records, and programafiestaspilarzaragoza.com, an unofficial site built from
the same PDF.

### The shape of an entry

```
16:00  III Festival Internacional de Circo de Zaragoza. Gran carpa
       blanca Valdespartera. Sesiones a las 12:00, 16:00 y 19:00 h.
```

The time, then the title, then details, then the venue last, all free text.
The parser has to read these phrasings:

- **Sessions:**
  - "Sesiones a las 12:00 h. y a las 17:30 h."
  - "Funciones: 12:00, 13:00, 17:30…"
  - "Pases cada 30 minutos de 17:00 a 22:30 h." (a `window`)
- **Ranges:**
  - "De 11:00 a 14:00 y de 17:00 a 21:00 h." (a `run` with split hours)
- **Ages:** "(+8 años)", "+4 años".
- **Booking:** "Entradas en https://entradium.com", "Reservas en la web de
  Gozarte".
- **Programme prefixes:**
  - "Las Food Trucks Zaragoza: …"
  - "Espacio Zity presenta: …"
  - "El Pilar en San José: …"
  - "Bandas en La Granja: …"
  - "Feria del Pilar 2026: …"
- **Routes:** "Recorrido: Plaza de España, Coso, Don Jaime, Plaza del Pilar,
  Puente de Piedra, Estación del Norte." For moving events: "Itinerante.
  Salida: Plaza José Sinués".
- **Organizers:** "Organiza: Unión Peñista."
- **After midnight:** acts at 04:15 (a mass), and the fairground open till
  05:00. Hence `localDate` and the edition's `dayStartsAt`.

### The venue directory

The directory (pp. 9 and 11) gives a name and an address for each of about
70 places, under these headings:

- Escenarios (the stages);
- Teatros;
- Museos;
- Salas y centros cívicos;
- Turismo.

It seeds the edition's venues and their `aliases`. Stages are temporary and
can share a square, so two stages sit inside Plaza del Pilar (`parentId`).

### Things that are not single acts

- **The fairground's hours change by date and run past midnight.** It also
  has a fireworks night, a quiet day ("Día sin ruido", 17:00–20:00) and
  discount days. These are programme `hours` and `notices`.
- **Markets run for days, with split daily hours.** These are runs.
- **Programmes run past the edition.** The circus festival runs 9 Oct–2 Nov and
  the fairground until 25 Oct, while the fiestas are 10–18 Oct, with
  "Actividades previas" on the 9th. An activity's dates are its own; the
  edition's dates are the official ones.
- **Some acts have no time.** "A continuación, Fuegos Artificiales" has no
  time of its own, and the unofficial site notes the fireworks' hour is not
  always published. Hence `time: 'unannounced'`.

### Categories

The official legend has 11 icons: Tradicional, Danza, Magia y circo, Ferias
y mercados, Infantil, Espectáculo teatral, Música, Toros, Deporte, Acto
religioso, Otras actividades. Our kinds need to cover them:

- `tradition`, `dance`, `circus`, `market`, `religious` and `bullfighting`
  join the list;
- the published label is kept as `categoryAsPublished`.

The unofficial site's categories are often wrong: a gymnastics trophy filed
as a religious act, the circus as a concert. Classification has to be
reviewable, and overrides are how it gets fixed.

### Accuracy

The PDF itself says it is correct "at the time of going to print", and that
changes go to fiestasdelpilar.com, which is zaragoza.es and the city's
event service.

1. The PDF is the first import.
2. During the edition, the city feed is the update.
3. Where the two disagree on an act's time, place or status, the service
   flags it for review instead of choosing silently.

### Ideas worth copying from the unofficial site

- **Day tabs with counts per day.** The days had 37 to 105 acts each.
- **Time-of-day blocks:** morning, midday, afternoon, night, after midnight.
- **One row with several times,** instead of one row per session.
- **Routes as an ordered list:** start, via, end.
- **Ticketed concerts (Espacio Zity) apart from the free city stages.**
- **A "what's left today" view.**

Its weaknesses are what this model adds:

- venues as text, with a map link that searches by name;
- no prices, end times, addresses or structured booking;
- the same act listed twice.

### What it meant for the design

An edition's page:

1. day tabs with counts;
2. time-of-day blocks;
3. a filter by kind, by "free", and by "near me";
4. a "Spaces" row for its programmes: the fairground with its hours, Espacio
   Zity with its tickets, the food trucks;
5. a map of every venue that has something on that day.

A parade draws its route on the map.

Beside the programme the edition's page carries:

- **Eat & drink:** the vendors by space, with dishes, prices and dietary
  filters.
- **Practical:** closures and transport changes first, then the services on
  a map.


The official programme carries four prices and one ticket seller in sixty pages, and nothing about Oktoberfest or the other private events alongside the fiestas: prices, tickets and vendors have to come from sellers and organizers.

## Navidad 2026

Measured on 23 November 2026, four days before it starts.

**What the city announced.** The programme was presented on 19 November:

- more than 600 activities (650 in the press) from 27 November 2026 to 6
  January 2027;
- the lights switched on Friday 27 November at 18:30 in Plaza Aragón, with
  Vicco singing;
- the lights then on daily from 18:00 to 01:00, at 90 points around the
  city.

**What the city's open data already holds:**

- 308 events under programme *Navidad*: `q=program.title==Navidad` works
  as a server-side filter;
- 347 tagged by programme or portal in our snapshot;
- 330 of those 347 with a map point, 38 with a price;
- most of them starting in December.

The snapshot lost about a quarter of all records to the unstable paging,
and the city's own programme page says 600. Phase 0's correct paging will
show whether the rest are in the feed under other programmes or only on the
web.

**Its places and spaces:**

- **La Plaza de la Navidad, Plaza del Pilar** (27 Nov–6 Jan), one programme
  with many children:
  - Belén de Judea, with life-size figures; weekdays 11:00–14:00 and
    16:00–21:00;
  - the ice rink by the Fuente de la Hispanidad;
  - the tubing slide, now behind La Lonja;
  - Sweet Palace;
  - two carousels (Dreamland and Hispanidad);
  - Express Navideño;
  - Papá Noel's house (visits to the 24th);
  - Árbol de los Deseos;
  - a stage with something most evenings: jota, gospel, magic, puppets,
    regional houses' groups.
- **Belén artístico** at the Ayuntamiento (to 4 Jan), and **Belén de San
  Pablo** (4 Dec–6 Jan).
- **"La Estrella",** a new immersive light show in the Jardín Botánico,
  Parque Grande.
- **Winter Garden – Mercado Gourmet,** Parque Grande (27 Nov–5 Jan).
- **Mercado Navideño,** Asociación de Expositores, Plaza Aragón (5 Dec–6
  Jan).
- **Puerto Venecia's own switch-on show,** 27 Nov.
- **The Cabalgata de Reyes, 5 January,** on a new route: Tenor Fleta, Avda.
  Goya, Paseo Teruel, Hernán Cortés, César Augusto, Coso, Alfonso I and
  Plaza del Pilar.
- **The portal's own sections,** each a programme or a page of its own: a
  route of lights (`ruta-luz`), the Reyes Magos' letters, a children's
  programme, shop windows, tourism.

**For the data model:**

- Plaza del Pilar is a programme with a dozen runs inside it: rides with
  their own hours, and a stage with daily sessions.
- The Cabalgata is a route.
- The lights are a notice with daily hours, not an activity.
- Every piece fits the model as it stands.

Sources: [Aragón Digital](https://www.aragondigital.es/articulo/zaragoza/navidad-zaragoza-2026-fechas-horarios-encendido-luces-cabalgata-reyes-programacion/202611191357311023034.html),
[HoyAragón](https://www.hoyaragon.es/zaragoza/zaragoza-encendera-navidad-vicco-nuevo-espectaculo-luces-parque-grande/20261119133910153237.html),
[Zaragozalá](https://zaragozala.com/fiestas/zaragoza-navidad-2026-presentacion-programa-novedades/),
[Con Peques en Zgz](https://conpequesenzgz.com/2026/10/fechas-especiales-belen-y-v-muestra-navidena/),
[zaragoza.es, Navidad](https://www.zaragoza.es/sede/portal/cultura/navidad/), and the
city's event service.

## Predicted dates

Each rule is checked against the editions whose dates we could confirm.
Dates are local.

| Series | Rule | Fits | Next expected | Precision |
|---|---|---|---|---|
| Fiestas del Pilar | The Monday on or before 12 Oct is M; from M−2 (Saturday) to M+6 (Sunday), plus Monday 13 when 12 Oct is a Sunday (the holiday moves) | 2024: 5–13 Oct ✓ · 2025: 4–13 Oct ✓ · 2026: 10–18 Oct ✓ | **9–17 Oct 2027** | day |
| Navidad | From the last weekend of November (switch-on on its Friday or Saturday) to 6 January | 2024: Fri 29 Nov ✓ · 2025: Sat 29 Nov ✓ · 2026: Fri 27 Nov ✓ | **26–27 Nov 2027 → 6 Jan 2028** | weekend |
| Semana Santa | Easter −7 (Palm Sunday) to Easter | by definition | **21–28 Mar 2027** | day |
| Halloween | 31 Oct | by definition | **31 Oct 2027** (a Sunday) | day |
| Carnaval | Easter −50 (Saturday) to −47 (Tuesday) | by definition; the city's parade day varies | **6–9 Feb 2027** | weekend |
| Cincomarzada | 5 Mar, the city's holiday | by definition | **5 Mar 2027** | day |
| San Valero | 29 Jan, the patron's day, with its roscón | by definition | **29 Jan 2027** | day |
| San Jorge | 23 Apr, Día de Aragón | by definition | **23 Apr 2027** | day |
| Champions Burger | None: the tour sets its dates each year | 2025: 3–20 Apr (Recinto Expo) · 2026: 18 Mar–5 Apr (Expo) | "Usually in March or April" | season |

Navidad 2026 needs no prediction: it is announced and about to start.
Pilar 2023's dates were not confirmed by a source; the rule gives 7–15 Oct.

Sources: [zaragoza.es, Pilar 2024](https://www.zaragoza.es/sede/portal/cultura/servicio/noticia/334875),
[Zaragozalá, Pilar 2024](https://zaragozala.com/fiestas-del-pilar-2024/),
[zaragoza.es, Pilar 2025](https://www.zaragoza.es/sede/portal/cultura/fiestas-pilar/servicio/noticia/343575),
[Zaragozalá, Navidad 2025](https://zaragozala.com/fiestas/zaragoza-navidad/cuando-es-el-encendido-de-la-navidad-en-zaragoza-2025/),
[zaragoza.es, Navidad 2024](https://www.zaragoza.es/sede/servicio/noticia/336760),
[Soy de Zaragoza, Champions Burger](https://www.soydezaragoza.es/champions-burger-zaragoza),
[Aragón Digital, Champions Burger 2025](https://www.aragondigital.com/2025/03/20/the-champions-burger-returns-to-zaragoza-dates-burgers-and-location/).
