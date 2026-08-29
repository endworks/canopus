import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { TTL } from '../utils';
import { AirGrade, AirSource } from './air-source';
import { Concentrations, europeanAqi } from './european-aqi';
import { upstreamGet } from './upstream';

/**
 * The city's own network, published as open data under its RISP terms.
 *
 * `listado.json` is the one endpoint that answers the whole question: the eight
 * stations, where each one stands, and what each has measured this hour and
 * last. One call an hour for the entire city.
 *
 * Its neighbours all fall short of that, which is worth writing down because
 * each of them looks like the right one:
 *
 *   - `estacion/horaria.json` without `estacion` answers **400**, "Required
 *     String parameter 'estacion' is not present". There is no un-parameterised
 *     form of it.
 *   - `estacion/horaria.json?estacion=<id>` works, but is one call per station,
 *     and names its pollutants with markup in them — `NO<sub>2</sub>`.
 *   - `calidad-aire.json` covers the network in one call and gives no
 *     coordinates at all: the station is a bare name. It also names pollutants
 *     by dbpedia URI, and was serving midnight's readings at eleven in the
 *     morning.
 *   - `estacion/?estacion=<id>` is a portal page. It answers 200 with
 *     `Content-Type: text/html`.
 *
 * Documented at https://www.zaragoza.es/sede/portal/datos-abiertos/servicio/catalogo/131
 */
export const API_URL =
  'https://www.zaragoza.es/sede/servicio/calidad-aire/listado.json';

/** Where a reader goes to see the network this answered from. */
const PORTAL_URL =
  'https://www.zaragoza.es/sede/portal/medioambiente/calidad-aire/';

/**
 * The municipal term, generously boxed, as a gate rather than as an answer.
 *
 * It is asked of every request the service serves, so it has to be a pair of
 * comparisons and not a lookup. Being generous costs nothing: a cell inside
 * this box but far from every station falls through to the model anyway, on
 * the distance rule below, and a box that clipped the outskirts would silently
 * hand those streets to the model without ever checking.
 */
const BOUNDS = { south: 41.45, north: 41.85, west: -1.3, east: -0.6 };

/**
 * How far a station may be and still be speaking about you, in kilometres.
 *
 * The eight stations sit across a city about fifteen kilometres wide, so five
 * covers the built-up part with overlap and refuses the industrial edges and
 * the villages inside the municipal term. It is the number that decides
 * whether this is a better answer than the model or a worse one: a station
 * four kilometres upwind of a different neighbourhood is not a measurement of
 * your air, it is an anecdote about somebody else's.
 */
export const MAX_DISTANCE_KM = 5;

/**
 * How old a reading may be and still be called the air now, in hours.
 *
 * The feed carries about two hours, so in ordinary running nothing here is
 * near this and the constant never fires. It is for the day the network stops
 * publishing: without it a document frozen last Tuesday still parses, still
 * grades, and is still preferred to the model — because being measured is what
 * ranks this source first, and a stale measurement keeps that rank while
 * losing the only thing that earned it.
 */
export const MAX_AGE_HOURS = 3;

/** Mean earth radius, in kilometres. */
const EARTH_RADIUS_KM = 6371;

/**
 * The five the European index is graded on, and the names a feed gives them.
 *
 * `listado.json` spells all five plainly — `PM2.5`, `PM10`, `NO2`, `O3`, `SO2`
 * — so on today's feed the first alias of each is the only one that ever
 * matches. The rest are kept because the portal does not spell a pollutant the
 * same way twice across its endpoints: the per-station document writes
 * `NO<sub>2</sub>`, the network document writes a dbpedia URI, and the station
 * pages write `Partículas PM10`. Normalising strips the accents, the case and
 * the punctuation, so every one of those collapses onto a single key.
 */
export const ALIASES: Record<keyof Concentrations, string[]> = {
  pm2_5: ['PM2.5', 'PM2,5', 'Partículas PM2,5'],
  pm10: ['PM10', 'Partículas PM10'],
  no2: ['NO2', 'Dióxido de nitrógeno'],
  o3: ['O3', 'Ozono'],
  so2: ['SO2', 'Dióxido de azufre'],
};

/** Case, accents and punctuation removed, so one pollutant has one key. */
export const normalise = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** The aliases above, inverted once into the lookup the scan actually wants. */
const BY_ALIAS = new Map<string, keyof Concentrations>(
  Object.entries(ALIASES).flatMap(([pollutant, aliases]) =>
    aliases.map(
      (alias) => [normalise(alias), pollutant as keyof Concentrations] as const,
    ),
  ),
);

/**
 * One hourly reading, as the station carries it.
 *
 * The number is `value` and only `value`. There is no scanning for a field
 * that might hold it: the record also carries an hour, a band and a class, and
 * a parser that guessed could grade the air on any of them.
 */
export type Observation = {
  publicationDate?: string;
  value?: string | number;
  magnitud?: string;
  estado?: string;
  periodo?: string;
};

/**
 * One station, as `listado.json` publishes it.
 *
 * `geometry` is the position to use and `x`/`y` are not, though both are
 * present and they disagree by about 240 metres. `x`/`y` are ED50 — the `geo`
 * link beside them says so, `EPSG23030`, and inverting them on the
 * International 1924 ellipsoid reproduces the station's own published
 * degrees-minutes-seconds to within a metre. `geometry` is the same points
 * moved to ETRS89, which is EPSG:25830 and which is WGS84 for any purpose
 * here.
 *
 * The written `latitud` and `longitud` fields are left alone entirely. Besides
 * being ED50 they are typed by hand and show it: Centro holds its UTM easting
 * and northing in them, Avda. Soria has neither, Las Fuentes closes its
 * seconds with two apostrophes, and Roger de Flor's are a kilometre from where
 * that station actually stands.
 *
 * `idSparql` is the id the other endpoints in this service take as `estacion`.
 * Nothing here needs it — one document covers the network — but it is the
 * bridge to the per-station history if anything ever does.
 */
export type StationRecord = {
  id?: number | string;
  idSparql?: number | string;
  title?: string;
  geometry?: { type?: string; coordinates?: number[] };
  observation?: Observation[];
};

/** The RISP envelope every zaragoza.es dataset comes in. */
export type ListadoResponse = { result?: StationRecord[] };

/** UTM zone 30, which is the one Aragón is in. */
const UTM_ZONE = 30;
/** Scale on the central meridian, which is UTM's everywhere. */
const UTM_SCALE = 0.9996;
/** GRS80, the ellipsoid ETRS89 is on and the one WGS84 shares. */
const GRS80 = { a: 6378137.0, f: 1 / 298.257222101 };

/**
 * A projected point back into degrees.
 *
 * The standard inverse transverse Mercator series, to the sixth order, which
 * is centimetres over a UTM zone and far finer than anything downstream: the
 * result feeds a distance compared against a five kilometre limit. Written out
 * rather than pulled in because a projection library for one formula used on
 * eight fixed points is a dependency to keep up to date forever.
 */
export const fromUtm = (
  easting: number,
  northing: number,
): { latitude: number; longitude: number } => {
  const { a, f } = GRS80;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);

  const x = easting - 500000;
  const m = northing / UTM_SCALE;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  // The footpoint latitude: where the northing alone would put you, on the
  // central meridian, before the easting bends it east or west.
  const foot =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const c1 = ep2 * Math.cos(foot) ** 2;
  const t1 = Math.tan(foot) ** 2;
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(foot) ** 2);
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(foot) ** 2) ** 1.5;
  const d = x / (n1 * UTM_SCALE);

  const latitude =
    foot -
    ((n1 * Math.tan(foot)) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) *
          d ** 6) /
          720);

  const longitude =
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5) /
        120) /
    Math.cos(foot);

  const meridian = (UTM_ZONE * 6 - 183) * (Math.PI / 180);
  return {
    latitude: latitude * (180 / Math.PI),
    longitude: (meridian + longitude) * (180 / Math.PI),
  };
};

/** How far apart two coordinates are, in kilometres. */
export const distance = (
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(toLat - fromLat);
  const dLon = radians(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(fromLat)) *
      Math.cos(radians(toLat)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
};

/** A number, whether the feed sent one or sent the digits of one. */
const numeric = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  // The decimal is a point on this endpoint and a comma on others, and a value
  // that is not a number at all — `<5`, `S/D`, an empty string for a station
  // mid-calibration — has to come back as nothing rather than as a zero.
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * The city's clock, which is the one its timestamps are on.
 *
 * `publicationDate` is `2026-08-28T10:00:00` — no zone, no offset, the wall
 * time in Zaragoza. Handing that to `new Date` reads it on *this* process's
 * clock instead, and this process is a container whose zone nobody has set. In
 * UTC, which is what a base image gives you, every reading then looks one or
 * two hours into the future; move the deployment east and they look hours old,
 * and `MAX_AGE_HOURS` starts throwing away a feed that is perfectly current.
 * So the zone is named rather than inherited.
 */
const MADRID = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * How far ahead of UTC Zaragoza is at a given instant, in milliseconds.
 *
 * Asked of the instant itself, so the answer is CET or CEST as that date
 * decides rather than as today does. It is a fixed point solved in one step:
 * the instant handed in is the timestamp read as UTC, which is off by exactly
 * the offset being looked for — near enough to land on the right side of a
 * daylight-saving switch except within the hour of the switch itself, where
 * the two answers are an hour apart and both are inside `MAX_AGE_HOURS`.
 */
const madridOffset = (instant: number): number => {
  const parts = Object.fromEntries(
    MADRID.formatToParts(new Date(instant)).map(({ type, value }) => [
      type,
      value,
    ]),
  );
  const onTheCityClock = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return onTheCityClock - instant;
};

/** When a reading says it was taken, or nothing if it does not say. */
const observedAt = (observation: Observation): number | undefined => {
  if (!observation.publicationDate) return undefined;
  // The digits read as UTC first, then moved onto the city's clock. A stamp
  // that already carries a zone — should the portal ever start sending one —
  // is left where it is.
  const stamp = observation.publicationDate;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(stamp);
  const at = Date.parse(zoned ? stamp : `${stamp}Z`);
  if (!Number.isFinite(at)) return undefined;
  return zoned ? at : at - madridOffset(at);
};

/** A station, once its position is known and its readings are gathered up. */
export interface Station {
  latitude: number;
  longitude: number;
  concentrations: Concentrations;
  /** The newest reading behind those concentrations, for the freshness rule. */
  observedAt: number;
}

/**
 * What one station is measuring in µg/m³, and when it last said so.
 *
 * Each pollutant takes its newest reading rather than the newest hour taking
 * all of them: the document carries about two hours and a station does not
 * report every pollutant in every one, so keeping only the latest hour would
 * throw away a PM2.5 from an hour ago in favour of nothing at all.
 *
 * The units are not converted. Spanish networks publish these five in µg/m³,
 * which is what the EEA's table is in — the exception is CO, published in
 * mg/m³, and the index is not graded on CO. A feed that moved to ppb would
 * need converting here and would otherwise grade clean air as hazardous, which
 * is the one failure of this file worth watching for.
 */
export const readings = (
  observations: Observation[],
): { concentrations: Concentrations; observedAt: number } | undefined => {
  const concentrations: Concentrations = {};
  const at: Partial<Record<keyof Concentrations, number>> = {};
  let newest = 0;

  for (const observation of observations) {
    const named = observation.magnitud;
    const pollutant = named ? BY_ALIAS.get(normalise(named)) : undefined;
    if (!pollutant) continue;

    const value = numeric(observation.value);
    if (value === undefined) continue;

    const taken = observedAt(observation) ?? 0;
    const held = at[pollutant];
    if (held !== undefined && held >= taken) continue;

    concentrations[pollutant] = value;
    at[pollutant] = taken;
    newest = Math.max(newest, taken);
  }

  return newest ? { concentrations, observedAt: newest } : undefined;
};

/**
 * Every station the document speaks for, and what each is measuring.
 *
 * A station with no position is dropped rather than defaulted: `covers` has
 * already said this cell is in Zaragoza, so a station without coordinates
 * would otherwise be treated as being wherever the caller is.
 */
export const stations = (records: StationRecord[]): Station[] => {
  const found: Station[] = [];

  for (const record of records) {
    const [easting, northing] = record.geometry?.coordinates ?? [];
    if (typeof easting !== 'number' || typeof northing !== 'number') continue;

    const measured = readings(record.observation ?? []);
    if (!measured) continue;

    found.push({ ...fromUtm(easting, northing), ...measured });
  }

  return found;
};

/**
 * The hour a reading was taken, written the way the city writes a date.
 *
 * Europe/Madrid because that is the clock the reading is on and the clock the
 * reader is on, and Spanish because the sentence it goes into is Spanish.
 */
const WHEN = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * Everything Ley 37/2007 asks a reuser to say, beyond the credit itself.
 *
 * Two obligations in one sentence because they are one field, and both are
 * genuinely required. The city must be said not to endorse the reuse — "no se
 * podrá indicar, insinuar o sugerir que el Ayuntamiento de Zaragoza participa,
 * patrocina o apoya la reutilización" — and the date the reused data was last
 * updated must be given, which is why this is built per reading rather than
 * fixed on the provider: the date is the hour the nearest station reported, and
 * no two callers need share it.
 *
 * Deliberately not `lastUpdated` on the response, which is the weather
 * observation's time from whichever provider answered the weather — a
 * different source on a different clock, and hours from this station's hour.
 *
 * Spanish, and not a translation target, for the same reason the notice is:
 * the terms are written about a Spanish body, and a translated denial names a
 * council that does not exist.
 */
const statement = (observedAt: number): string =>
  `Datos actualizados el ${WHEN.format(new Date(observedAt))}. ` +
  'El Ayuntamiento de Zaragoza no participa, patrocina ni apoya esta ' +
  'reutilización de sus datos.';

/**
 * The air in Zaragoza, measured rather than modelled.
 *
 * Open-Meteo answers this cell too, from the 11-kilometre CAMS European
 * ensemble — which is a cell wider than the city. The service rounds a
 * coordinate to about one kilometre and says so in `location`, so on the air
 * it was quietly answering a question eleven times coarser than the one it
 * advertised. The city runs eight stations inside that single model cell, and
 * where one of them is close enough it is simply a better answer to the
 * question actually asked.
 *
 * It is not a better answer anywhere else, which is the point of `covers` and
 * of the distance rule: this speaks for a few square kilometres of one city and
 * hands everything else back to the model without comment.
 */
@Injectable()
export class ZaragozaAirProvider extends AirSource {
  readonly name = 'Ayuntamiento de Zaragoza';
  readonly url = PORTAL_URL;
  readonly measured = true;
  /**
   * The city publishes its open data under the reuse terms of Ley 37/2007, so
   * the credit carries those terms rather than a Creative Commons deed the
   * portal does not actually claim.
   *
   * This is the conditions themselves and not `ciudad/risp/decalogo.htm`,
   * which is the ten-point summary of them: the decalogue is the friendlier
   * page and it is not the one that binds anybody, and a reader who follows a
   * `licence` link to find out what they owe should land on the obligations
   * rather than on a link to them.
   *
   * The address the portal itself now serves, rather than the
   * `ciudad/servicios/avisolegal.htm` the decalogue still points at — that one
   * 301s here, and a credit that survives one redirect is a credit that breaks
   * on the next reorganisation. The `#condiciones` anchor is on both.
   */
  readonly licence =
    'https://www.zaragoza.es/sede/portal/aviso-legal#condiciones';
  /**
   * The citation those terms ask for, in the city's own words and its own
   * language. Not translated on the way out: it is the wording the licence
   * names, and a client that renders "Data from Zaragoza City Council" has
   * credited somebody the licence has never heard of.
   */
  readonly notice = 'Origen de los datos: Ayuntamiento de Zaragoza';

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {
    super();
  }

  covers(latitude: number, longitude: number): boolean {
    return (
      latitude >= BOUNDS.south &&
      latitude <= BOUNDS.north &&
      longitude >= BOUNDS.west &&
      longitude <= BOUNDS.east
    );
  }

  /**
   * The nearest station's grade, or nothing at all.
   *
   * Nothing is the ordinary answer for most of the box — the municipal term is
   * mostly fields — and it is not a failure: the service falls back to
   * whatever it would have used had this network never existed, so the caller
   * cannot tell that this was asked. That is what lets the bounds above be
   * generous.
   */
  async read(
    latitude: number,
    longitude: number,
  ): Promise<AirGrade | undefined> {
    // One cache entry for the whole network, not one per cell. The document is
    // the same for every caller in the city and the stations publish hourly, so
    // this is one upstream call an hour however many people ask.
    const body = await this.cacheManager.wrap(
      'zaragoza/air/listado',
      () => upstreamGet<ListadoResponse>(this.httpService, API_URL, this.name),
      TTL.airQuality,
    );

    const graded = this.nearest(
      stations(body?.result ?? []),
      latitude,
      longitude,
    );
    if (!graded) return undefined;

    return {
      index: graded.index,
      disclaimer: statement(graded.observedAt),
    };
  }

  /**
   * The closest station within range that is actually measuring something.
   *
   * A station in range that reported nothing this hour — offline, or
   * mid-calibration — must not shadow one a little further away that did, so
   * this ranks by distance and takes the first that grades rather than taking
   * the first and hoping.
   */
  private nearest(
    network: Station[],
    latitude: number,
    longitude: number,
  ): { index: number; observedAt: number } | undefined {
    const stale = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;

    return network
      .filter((station) => station.observedAt >= stale)
      .map((station) => ({
        station,
        km: distance(latitude, longitude, station.latitude, station.longitude),
      }))
      .filter((entry) => entry.km <= MAX_DISTANCE_KM)
      .sort((a, b) => a.km - b.km)
      .map((entry) => ({
        index: europeanAqi(entry.station.concentrations),
        observedAt: entry.station.observedAt,
      }))
      .find(
        (graded): graded is { index: number; observedAt: number } =>
          graded.index !== undefined,
      );
  }
}
