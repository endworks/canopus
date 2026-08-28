/**
 * Say why Zaragoza's air is not coming back, one stage at a time.
 *
 * The provider is built to fail quietly: a city that cannot answer falls
 * through to Open-Meteo so the caller keeps their air, which is the right
 * behaviour in production and the wrong one at a terminal — "no grade" is the
 * same output whether the endpoint moved, the envelope changed, the station
 * coordinates went missing, the pollutant is spelled differently or the value
 * sits under a key this does not know. This separates those five.
 *
 *   pnpm --filter @canopus/weather zaragoza-air
 *   pnpm --filter @canopus/weather zaragoza-air -- 41.6561 -0.8797
 *
 * A saved body works too, for somewhere the endpoint is not reachable from:
 *
 *   curl -s "$URL" > body.json
 *   pnpm --filter @canopus/weather zaragoza-air -- body.json
 *
 * It imports the provider's own constants and its own grouping rather than
 * repeating them: a diagnostic that agrees with a copy of the parser and
 * disagrees with the parser is worse than none.
 */
import { readFileSync } from 'node:fs';
import {
  ALIASES,
  API_URL,
  distance,
  HourlyResponse,
  MAX_DISTANCE_KM,
  normalise,
  Reading,
  stations,
  VALUE_KEYS,
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
    note('a portal path can answer 200 with a JSON content-type and HTML in');
    note('the body — check the URL, not the header');
    return;
  }
  ok(`body starts '${first}'`);

  // ---- 2. The RISP envelope ----------------------------------------------
  stage(2, 'envelope');
  let body: HourlyResponse & { totalCount?: number };
  try {
    body = JSON.parse(text) as HourlyResponse & { totalCount?: number };
  } catch (error) {
    no(`not parseable: ${(error as Error).message}`);
    return;
  }
  const records: Reading[] = body.result ?? [];
  if (!records.length) {
    no('no `result` array, or it is empty');
    note(`top-level keys: ${Object.keys(body).join(', ')}`);
    note('if this needs ?estacion=<id>, the provider needs a station registry');
    return;
  }
  ok(`result[] with ${records.length} records, totalCount ${body.totalCount}`);

  // ---- 3. Stations, and whether they carry a position ---------------------
  stage(3, 'stations');
  const network = stations(records);
  if (!network.length) {
    no('no record carried estacion.id with a numeric latitud and longitud');
    note(`first record: ${JSON.stringify(records[0], null, 2).slice(0, 600)}`);
    return;
  }
  const ranked = network
    .map((station) => ({
      station,
      km: distance(latitude, longitude, station.latitude, station.longitude),
    }))
    .sort((a, b) => a.km - b.km);
  ok(`${network.length} stations`);
  for (const { station, km } of ranked.slice(0, 4)) {
    const measured = Object.entries(station.concentrations)
      .map(([pollutant, value]) => `${pollutant}=${value}`)
      .join(' ');
    note(
      `${km.toFixed(2)} km  ${station.latitude},${station.longitude}  ` +
        `${measured || '(nothing measured)'}`,
    );
  }
  if (ranked[0].km > MAX_DISTANCE_KM) {
    no(
      `nearest is ${ranked[0].km.toFixed(2)} km, past the ${MAX_DISTANCE_KM} km limit`,
    );
    note('this coordinate is inside the box but not near a station');
  }

  // ---- 4. Are the pollutants named the way the aliases expect? ------------
  stage(4, 'pollutants');
  const named = [
    ...new Set(
      records
        .map((record) => record.contaminante?.title)
        .filter((title): title is string => Boolean(title)),
    ),
  ];
  if (!named.length) {
    no('no record carried contaminante.title');
    note(`first record keys: ${Object.keys(records[0]).join(', ')}`);
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
      // Most of these are meant to be unrecognised: the feed publishes CO and
      // benzene too, and the European index is not graded on either.
      note('only PM2.5, PM10, NO2, O3 and SO2 matter — if one of those is in');
      note('that list, its spelling belongs in ALIASES');
    }
  }

  // ---- 5. Which key holds the number? ------------------------------------
  stage(5, 'value field');
  const withValue = records.filter((record) =>
    Object.keys(record).some((key) => VALUE_KEYS.includes(normalise(key))),
  );
  if (withValue.length) {
    ok(`${withValue.length}/${records.length} records have a known value key`);
  } else {
    no(`no record has any of: ${VALUE_KEYS.join(', ')}`);
    // The whole point of the script: name the candidates so the fix is one
    // entry in VALUE_KEYS rather than another round of guessing.
    const numeric = Object.entries(records[0]).filter(
      ([, value]) =>
        typeof value === 'number' ||
        (typeof value === 'string' &&
          value.trim() !== '' &&
          Number.isFinite(Number(value.trim().replace(',', '.')))),
    );
    note(
      `numeric-looking keys on the first record: ${
        numeric.map(([key, value]) => `${key}=${value}`).join(', ') || 'none'
      }`,
    );
    note(`first record: ${JSON.stringify(records[0], null, 2).slice(0, 600)}`);
  }

  // ---- 6. The grade the service would actually return ---------------------
  stage(6, 'grade');
  const nearest = ranked.find((entry) => entry.km <= MAX_DISTANCE_KM);
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
