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
 * One document for the whole network rather than one per station: the portal
 * serves the same shape for the bike docks, and asking it once an hour for
 * eight stations is cheaper for them and for us than asking it eight times.
 */
const API_URL =
  'https://www.zaragoza.es/sede/servicio/calidad-aire/estacion.json';

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
 * One station as the portal publishes it.
 *
 * Loose on purpose, and the only place in this file that knows the feed's
 * shape. The portal serves its datasets through one templating layer and names
 * the same idea differently in each — the bike docks call a live reading
 * `bicisDisponibles`, and there is no reason to expect the air to have picked
 * the same conventions — so what is named here is only the part the RISP
 * envelope guarantees, `id`, `title` and `geometry`, and the readings are found
 * by the scan below rather than by a key this file has to be right about.
 */
type Station = {
  id?: string | number;
  title?: string;
  geometry?: { coordinates?: number[] };
} & Record<string, unknown>;

/** The RISP envelope every zaragoza.es dataset comes in. */
type StationsResponse = { result?: Station[] };

/** One reading, whichever of the portal's spellings it arrived under. */
type Reading = Record<string, unknown>;

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
 * One pollutant out of one reading, or nothing where it is not certain.
 *
 * The record names its pollutant in one field and carries the number in
 * another, and only the second has a promised name — so the pollutant is
 * looked for among the strings, and the number is taken from a field that says
 * it is the value and from nowhere else.
 *
 * The tempting fallback is "the only number in the record", and it is a trap:
 * `{ titulo: 'NO2', estacion: 38, hora: 12 }` has exactly one number left once
 * the station is discounted, and it is the hour. This feeds an index people
 * read as a health warning, so a record that does not say which number it means
 * is refused, and the model behind it answers instead.
 */
const measurement = (
  record: Reading,
): [keyof Concentrations, number] | undefined => {
  const pollutant = Object.values(record)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => BY_ALIAS.get(normalise(value)))
    .find((match): match is keyof Concentrations => match !== undefined);
  if (!pollutant) return undefined;

  const named = Object.entries(record).find(([key]) =>
    VALUE_KEYS.includes(normalise(key)),
  );
  const measured = named ? numeric(named[1]) : undefined;
  return measured === undefined ? undefined : [pollutant, measured];
};

/**
 * What a station is measuring, in µg/m³.
 *
 * Two shapes are read, because the portal uses both across its datasets and
 * promises neither: the pollutants may be fields on the station itself
 * (`{ no2: 21 }`) or a list of readings hanging off it
 * (`[{ titulo: 'NO2', valor: 21 }]`). The list is read first, so a dated
 * reading wins over a summary field of the same name.
 *
 * The units are not converted. Spanish networks publish these five in µg/m³,
 * which is what the EEA's table is in — the exception is CO, published in
 * mg/m³, and the index is not graded on CO. A feed that moved to ppb would
 * need converting here and would otherwise grade clean air as hazardous, which
 * is the one failure of this file worth watching for.
 */
const concentrations = (station: Station): Concentrations => {
  const found: Concentrations = {};
  const keep = (pollutant: keyof Concentrations, value: number) => {
    if (found[pollutant] === undefined) found[pollutant] = value;
  };

  const readings = Object.values(station)
    .filter((value): value is Reading[] => Array.isArray(value))
    .flat()
    .filter(
      (entry): entry is Reading => typeof entry === 'object' && entry !== null,
    );

  for (const record of readings) {
    const measured = measurement(record);
    if (measured) keep(...measured);
  }

  for (const [key, value] of Object.entries(station)) {
    const pollutant = BY_ALIAS.get(normalise(key));
    const measured = numeric(value);
    if (pollutant && measured !== undefined) keep(pollutant, measured);
  }

  return found;
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
    // the same for every caller in the city, and the stations publish hourly,
    // so this is one upstream call an hour however many people ask.
    const body = await this.cacheManager.wrap(
      'zaragoza/air/stations',
      () => upstreamGet<StationsResponse>(this.httpService, API_URL, this.name),
      TTL.airQuality,
    );

    const nearest = this.nearest(body?.result ?? [], latitude, longitude);
    if (!nearest) return undefined;

    return europeanAqi(concentrations(nearest));
  }

  /**
   * The closest station within range, and only if it is measuring something.
   *
   * A station that is in range but reported nothing this hour — offline, or
   * mid-calibration — must not shadow one a little further away that did, so
   * this ranks by distance and takes the first that actually answers rather
   * than taking the first and hoping.
   */
  private nearest(
    stations: Station[],
    latitude: number,
    longitude: number,
  ): Station | undefined {
    return stations
      .map((station) => {
        // GeoJSON order: longitude first. Getting this backwards puts every
        // station in the Indian Ocean and quietly disables the whole provider,
        // which is exactly the sort of failure the fall-through would hide.
        const [lon, lat] = station.geometry?.coordinates ?? [];
        if (typeof lat !== 'number' || typeof lon !== 'number')
          return undefined;
        return { station, km: distance(latitude, longitude, lat, lon) };
      })
      .filter(
        (entry): entry is { station: Station; km: number } =>
          entry !== undefined && entry.km <= MAX_DISTANCE_KM,
      )
      .sort((a, b) => a.km - b.km)
      .map((entry) => entry.station)
      .find((station) => europeanAqi(concentrations(station)) !== undefined);
  }
}
