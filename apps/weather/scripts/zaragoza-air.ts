/**
 * Say why Zaragoza's air is not coming back, one stage at a time.
 *
 * The provider is built to fail quietly: a city that cannot answer falls
 * through to Open-Meteo so the caller keeps their air, which is the right
 * behaviour in production and the wrong one at a terminal — "no grade" is the
 * same output whether the endpoint moved, the envelope changed, a station lost
 * its geometry, the pollutant is spelled differently, or the network simply
 * stopped publishing. This separates those.
 *
 *   pnpm --filter @canopus/weather zaragoza-air
 *   pnpm --filter @canopus/weather zaragoza-air -- 41.6561 -0.8797
 *
 * A saved body works too, for somewhere the endpoint is not reachable from:
 *
 *   curl -s "$URL" > body.json
 *   pnpm --filter @canopus/weather zaragoza-air -- body.json
 *
 * It imports the provider's own constants and its own parsing rather than
 * repeating them: a diagnostic that agrees with a copy of the parser and
 * disagrees with the parser is worse than none.
 */
import { readFileSync } from 'node:fs';
import {
  ALIASES,
  API_URL,
  distance,
  fromUtm,
  ListadoResponse,
  MAX_AGE_HOURS,
  MAX_DISTANCE_KM,
  normalise,
  readings,
  StationRecord,
  stations,
} from '../src/providers/zaragoza-air.provider';
import { europeanAqi } from '../src/providers/european-aqi';

const args = process.argv.slice(2);
/** A saved body to read instead of fetching, for where the host is blocked. */
const file = args.find((arg) => arg.endsWith('.json'));
/**
 * Plaza del Pilar, unless the caller names somewhere else.
 *
 * Filtered to finite numbers rather than destructured straight off the args: a
 * default only fills an `undefined`, so a stray `--` from the package manager
 * becomes `Number('--')`, which is `NaN`, which is not undefined — and every
 * distance downstream silently becomes NaN too.
 */
const [latitude = 41.6563, longitude = -0.8781] = args
  .filter((arg) => arg !== file)
  .map(Number)
  .filter((value) => Number.isFinite(value));

const ok = (line: string) => console.log(`  \x1b[32m✓\x1b[0m ${line}`);
const no = (line: string) => console.log(`  \x1b[31m✗\x1b[0m ${line}`);
const note = (line: string) => console.log(`    ${line}`);
const stage = (n: number, name: string) => console.log(`\n${n}. ${name}`);

/** The body, from the service or from disk. */
const fetchBody = async (): Promise<string | undefined> => {
  if (file) {
    stage(1, `read ${file}`);
    const text = readFileSync(file, 'utf8');
    console.log(`  ${text.length} bytes`);
    return text;
  }

  stage(1, 'fetch');
  const response = await fetch(API_URL).catch((error: Error) => error);
  if (response instanceof Error) {
    no(`unreachable: ${response.message}`);
    return undefined;
  }
  const type = response.headers.get('content-type') ?? 'none';
  const text = await response.text();
  console.log(`  ${response.status}, ${type}, ${text.length} bytes`);
  if (!response.ok) {
    no(`the service refused: ${text.slice(0, 200)}`);
    // The mistake this endpoint punishes. `estacion/horaria.json` looks like
    // the network document and answers 400 without a station id.
    note('a 400 here usually means the URL wants ?estacion=<id>, which means');
    note('it is the per-station endpoint and not listado.json');
    return undefined;
  }
  return text;
};

const main = async () => {
  console.log(file ? '' : `\nGET ${API_URL}`);

  // ---- 1. Does it answer, and with JSON rather than a page? --------------
  const text = await fetchBody();
  if (text === undefined) return;
  const first = text.trimStart().slice(0, 1);
  if (first !== '{' && first !== '[') {
    no(`body starts '${first}', so this is a page and not the service`);
    note('a portal path can answer 200 and HTML — check the URL, not the');
    note('header: estacion/?estacion=40 is a page, listado.json is a service');
    return;
  }
  ok(`body starts '${first}'`);

  // ---- 2. The RISP envelope ----------------------------------------------
  stage(2, 'envelope');
  let body: ListadoResponse & { totalCount?: number };
  try {
    body = JSON.parse(text) as ListadoResponse & { totalCount?: number };
  } catch (error) {
    no(`not parseable: ${(error as Error).message}`);
    return;
  }
  const records: StationRecord[] = body.result ?? [];
  if (!records.length) {
    no('no `result` array, or it is empty');
    note(`top-level keys: ${Object.keys(body).join(', ')}`);
    return;
  }
  ok(`result[] with ${records.length} stations, totalCount ${body.totalCount}`);
  note(
    records
      .map((record) => `${record.title ?? '?'} (${record.idSparql ?? '?'})`)
      .join(', '),
  );

  // ---- 3. Does every station carry a position? ----------------------------
  stage(3, 'geometry');
  const positioned = records.filter(
    (record) => (record.geometry?.coordinates?.length ?? 0) >= 2,
  );
  if (!positioned.length) {
    no('no station carried geometry.coordinates');
    note(`first station keys: ${Object.keys(records[0]).join(', ')}`);
    note('the written latitud/longitud are ED50 and unreliable — if geometry');
    note('is gone, x/y are the fallback and need the ED50 ellipsoid');
    return;
  }
  ok(`${positioned.length}/${records.length} stations have geometry`);
  for (const record of records) {
    const [easting, northing] = record.geometry?.coordinates ?? [];
    if (typeof easting !== 'number' || typeof northing !== 'number') {
      no(`${record.title ?? '?'} has no geometry`);
      continue;
    }
    const at = fromUtm(easting, northing);
    note(
      `${(record.title ?? '?').padEnd(14)} ${at.latitude.toFixed(5)}, ` +
        `${at.longitude.toFixed(5)}`,
    );
  }

  // ---- 4. Are the pollutants named the way the aliases expect? ------------
  stage(4, 'pollutants');
  const named = [
    ...new Set(
      records
        .flatMap((record) => record.observation ?? [])
        .map((observed) => observed.magnitud)
        .filter((magnitud): magnitud is string => Boolean(magnitud)),
    ),
  ];
  if (!named.length) {
    no('no station carried observation[].magnitud');
    note(`first station keys: ${Object.keys(records[0]).join(', ')}`);
  } else {
    const known = new Set(
      Object.values(ALIASES)
        .flat()
        .map((alias) => normalise(alias)),
    );
    const matched = named.filter((title) => known.has(normalise(title)));
    const missed = named.filter((title) => !known.has(normalise(title)));
    if (matched.length) ok(`recognised: ${matched.join(', ')}`);
    else no('none of the names matched ALIASES');
    if (missed.length) {
      note(`not recognised: ${missed.join(', ')}`);
      // Most of these are meant to be unrecognised: the feed publishes CO,
      // NO, benzene and hydrogen sulphide too, and the European index is
      // graded on none of them.
      note('only PM2.5, PM10, NO2, O3 and SO2 matter — if one of those is in');
      note('that list, its spelling belongs in ALIASES');
    }
  }

  // ---- 5. How old is what it is publishing? ------------------------------
  stage(5, 'freshness');
  const ages = records
    .map((record) => readings(record.observation ?? []))
    .filter((measured): measured is NonNullable<typeof measured> =>
      Boolean(measured),
    )
    .map((measured) => (Date.now() - measured.observedAt) / (60 * 60 * 1000));
  if (!ages.length) {
    no('no station produced a timed reading of a graded pollutant');
    note(
      `first station's observations: ${JSON.stringify(
        records[0].observation?.slice(0, 3),
        null,
        2,
      )}`,
    );
  } else {
    const newest = Math.min(...ages);
    const line = `newest reading is ${newest.toFixed(1)} h old`;
    if (newest <= MAX_AGE_HOURS) ok(line);
    else {
      no(`${line}, past the ${MAX_AGE_HOURS} h limit`);
      note('the whole network would be refused as stale — either it stopped');
      note('publishing, or publicationDate is not being read on Madrid time');
    }
  }

  // ---- 6. The stations as the provider sees them --------------------------
  stage(6, 'stations');
  const network = stations(records);
  if (!network.length) {
    no('no station survived parsing');
    return;
  }
  const ranked = network
    .map((station) => ({
      station,
      km: distance(latitude, longitude, station.latitude, station.longitude),
    }))
    .sort((a, b) => a.km - b.km);
  ok(`${network.length} stations parsed`);
  for (const { station, km } of ranked.slice(0, 4)) {
    const measured = Object.entries(station.concentrations)
      .map(([pollutant, value]) => `${pollutant}=${value}`)
      .join(' ');
    note(`${km.toFixed(2)} km  ${measured || '(nothing measured)'}`);
  }
  if (ranked[0].km > MAX_DISTANCE_KM) {
    no(
      `nearest is ${ranked[0].km.toFixed(2)} km, past the ${MAX_DISTANCE_KM} km limit`,
    );
    note('this coordinate is inside the box but not near a station');
  }

  // ---- 7. The grade the service would actually return ---------------------
  stage(7, 'grade');
  const stale = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
  const nearest = ranked.find(
    (entry) => entry.km <= MAX_DISTANCE_KM && entry.station.observedAt >= stale,
  );
  const grade = nearest
    ? europeanAqi(nearest.station.concentrations)
    : undefined;
  if (grade === undefined) {
    no('no grade — the service would fall through to Open-Meteo');
  } else {
    ok(
      `European AQI ${grade} from a station ${nearest?.km.toFixed(2)} km away`,
    );
  }
  console.log('');
};

void main();
