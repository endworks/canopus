import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { TTL } from '../utils';
import { AirSource } from './air-source';
import { Concentrations, europeanAqi } from './european-aqi';
import { upstreamGet } from './upstream';

/**
 * The city's own network, published as open data under its RISP terms.
 *
 * The hourly readings, asked for without naming a station, so one document
 * covers the whole network: every record carries the station that made it, so
 * a single call an hour answers for everyone in the city rather than one call
 * per station per cell.
 *
 * The neighbouring path — `estacion/?estacion=40` — looks like the same thing
 * and is not: it answers a portal page with `Content-Type: application/json`
 * and HTML in the body, which is a trap worth naming here so nobody
 * rediscovers it. `horaria.json` is the service.
 */
const API_URL =
  'https://www.zaragoza.es/sede/servicio/calidad-aire/estacion/horaria.json';

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
const MAX_DISTANCE_KM = 5;

/** Mean earth radius, in kilometres. */
const EARTH_RADIUS_KM = 6371;

/**
 * The five the European index is graded on, and the names a feed gives them.
 *
 * Matched on a normalised name rather than on a fixed key because the portal
 * does not spell a pollutant the same way twice — `PM10` on one page, `PM 10`
 * on another, `Partículas PM10` in a station detail — and because the accented
 * Spanish names are the ones most likely to be respelled without the data
 * changing at all. Normalising strips the accents, the case and the
 * punctuation, so every one of those collapses onto a single key.
 */
const ALIASES: Record<keyof Concentrations, string[]> = {
  pm2_5: ['PM2.5', 'PM2,5', 'Partículas PM2,5'],
  pm10: ['PM10', 'Partículas PM10'],
  no2: ['NO2', 'Dióxido de nitrógeno'],
  o3: ['O3', 'Ozono'],
  so2: ['SO2', 'Dióxido de azufre'],
};

/**
 * The keys a feed puts the measured number under.
 *
 * A reading is taken from one of these and from nowhere else, because guessing
 * is where this file could do real harm: a record is
 * `{ id, estacion, titulo, valor }` and reading the wrong field grades the air
 * on a station number. A key that says what it holds removes the question.
 */
const VALUE_KEYS = ['valor', 'value', 'medicion', 'dato', 'cantidad'];

/** Case, accents and punctuation removed, so one pollutant has one key. */
const normalise = (value: string): string =>
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
 * One hourly reading, as the portal publishes it.
 *
 * The RISP envelope every zaragoza.es dataset comes in, with the reading's own
 * station embedded in each record rather than listed once — which is what makes
 * the un-parameterised call worth making: one document, every station, grouped
 * back together here.
 *
 * The station's position is a pair of flat fields and not a GeoJSON point, so
 * there is no coordinate order to get backwards; and the pollutant is a nested
 * object whose `title` names it, rather than a loose string to be recognised
 * among its neighbours.
 */
type Reading = {
  estacion?: {
    id?: string | number;
    title?: string;
    latitud?: string | number;
    longitud?: string | number;
  };
  contaminante?: { id?: string | number; title?: string };
} & Record<string, unknown>;

/** The RISP envelope, paginated like the rest of the portal's datasets. */
type HourlyResponse = { result?: Reading[] };

/** How far apart two coordinates are, in kilometres. */
const distance = (
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
  // Spanish decimals arrive with a comma, and a value that is not a number at
  // all — `<5`, `S/D`, an empty string for a station mid-calibration — has to
  // come back as nothing rather than as a zero.
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * What one reading measured, or nothing where it is not certain.
 *
 * The pollutant is `contaminante.title`, which is the one part of this the
 * feed names unambiguously. The number is taken from a field that says it is
 * the value and from nowhere else: a record carries a station id, an altitude
 * and an hour besides, and reading the wrong one would grade the air on a
 * street number. Refusing an ambiguous record is the point — this feeds an
 * index people read as a health warning, and a plausible wrong value is worse
 * than the model answer it displaces.
 */
const measurement = (
  record: Reading,
): [keyof Concentrations, number] | undefined => {
  const named = record.contaminante?.title;
  const pollutant = named ? BY_ALIAS.get(normalise(named)) : undefined;
  if (!pollutant) return undefined;

  const value = Object.entries(record).find(([key]) =>
    VALUE_KEYS.includes(normalise(key)),
  );
  const measured = value ? numeric(value[1]) : undefined;
  return measured === undefined ? undefined : [pollutant, measured];
};

/**
 * The readings grouped back into the stations that made them.
 *
 * Keyed by the station's own id rather than by its name, because two of the
 * network's stations share a street and a name is not a key.
 */
interface Station {
  latitude: number;
  longitude: number;
  concentrations: Concentrations;
}

/**
 * Every station the document speaks for, and what each is measuring in µg/m³.
 *
 * The units are not converted. Spanish networks publish these five in µg/m³,
 * which is what the EEA's table is in — the exception is CO, published in
 * mg/m³, and the index is not graded on CO. A feed that moved to ppb would
 * need converting here and would otherwise grade clean air as hazardous, which
 * is the one failure of this file worth watching for.
 */
const stations = (readings: Reading[]): Station[] => {
  const found = new Map<string, Station>();

  for (const record of readings) {
    const id = record.estacion?.id;
    const latitude = numeric(record.estacion?.latitud);
    const longitude = numeric(record.estacion?.longitud);
    if (id === undefined || latitude === undefined || longitude === undefined) {
      continue;
    }

    const station = found.get(String(id)) ?? {
      latitude,
      longitude,
      concentrations: {},
    };
    found.set(String(id), station);

    const measured = measurement(record);
    // First one wins: the document is an hour's worth and a station may report
    // the same pollutant more than once in it.
    if (measured && station.concentrations[measured[0]] === undefined) {
      station.concentrations[measured[0]] = measured[1];
    }
  }

  return [...found.values()];
};

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
   * The city publishes its open data under the reuse terms of Ley 37/2007,
   * which ask to be credited as the source — so the credit carries the terms
   * rather than a Creative Commons deed the portal does not actually claim.
   */
  readonly licence = 'https://www.zaragoza.es/ciudad/risp/decalogo.htm';
  /**
   * The citation those terms ask for, in the city's own words and its own
   * language. Not translated on the way out: it is the wording the licence
   * names, and a client that renders "Data from Zaragoza City Council" has
   * credited somebody the licence has never heard of.
   *
   * The terms also ask for the date the source was last updated. That is
   * `lastUpdated` on the response, which carries the observation's own time
   * rather than the moment it was served.
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
   * mostly fields — and it is not a failure: `AirSources` falls through to the
   * model, so the caller cannot tell that this was asked. That is what lets the
   * bounds above be generous.
   */
  async read(latitude: number, longitude: number): Promise<number | undefined> {
    // One cache entry for the whole network, not one per cell. The document is
    // the same for every caller in the city and the stations publish hourly, so
    // this is one upstream call an hour however many people ask.
    const body = await this.cacheManager.wrap(
      'zaragoza/air/hourly',
      () => upstreamGet<HourlyResponse>(this.httpService, API_URL, this.name),
      TTL.airQuality,
    );

    return this.nearest(stations(body?.result ?? []), latitude, longitude);
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
  ): number | undefined {
    return network
      .map((station) => ({
        station,
        km: distance(latitude, longitude, station.latitude, station.longitude),
      }))
      .filter((entry) => entry.km <= MAX_DISTANCE_KM)
      .sort((a, b) => a.km - b.km)
      .map((entry) => europeanAqi(entry.station.concentrations))
      .find((grade) => grade !== undefined);
  }
}
