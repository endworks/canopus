// Regenerates src/data/meteoalarm-regions.json, the atlas that turns a cell
// into the warning regions containing it.
//
// MeteoAlarm scopes every warning by a region code and publishes no geometry
// for those codes: the feeds carry none, and the one API that does — the EDR
// service at api.meteoalarm.org — is behind a token handed out by email. The
// atlas below is the public one, MIT licensed, from the `meteoalarm` Python
// package.
//
// It is reduced on the way in, from 31 MB to about 2 MB:
//
//   - Outer rings only. A ring's holes can only ever make a region smaller, so
//     dropping them can over-include a warning but never lose one, and for a
//     warning that is the safe direction to be wrong in.
//   - Two decimals of coordinate, about 1.1 km. The cell asked about is 11 km
//     wide, so the atlas is already an order of magnitude finer than the
//     question it answers.
//   - Rings flattened to [x, y, x, y, …] and a bounding box precomputed, both
//     to keep the parsed atlas small in memory and to reject most regions
//     without walking their edges.
//
// Usage: node scripts/build-regions.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE =
  'https://raw.githubusercontent.com/NiklasJordan/meteoalarm/main/src/meteoalarm/assets/geocodes.json';
const LICENCE = 'MIT, Copyright (c) 2025 Niklas Jordan';
const PRECISION = 2;

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'data', 'meteoalarm-regions.json');

const round = (value) => Number(value.toFixed(PRECISION));

/** One ring, rounded and flattened, with the points rounding made adjacent dropped. */
const ring = (points) => {
  const flat = [];
  for (const [longitude, latitude] of points) {
    const x = round(longitude);
    const y = round(latitude);
    if (flat.length >= 2 && flat.at(-2) === x && flat.at(-1) === y) continue;
    flat.push(x, y);
  }
  // Three points is the least that can enclose anything; below that the
  // rounding has collapsed the region and there is nothing left to test.
  return flat.length >= 8 ? flat : undefined;
};

const main = async () => {
  process.stdout.write(`Fetching ${SOURCE}\n`);
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Source answered ${response.status}`);
  const atlas = await response.json();

  const regions = {};
  let kept = 0;
  let dropped = 0;

  for (const feature of atlas.features) {
    const { code, country, name, type } = feature.properties;
    if (type !== 'EMMA_ID' || !code || !country) continue;

    const polygons =
      feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];

    const rings = polygons
      .map((polygon) => ring(polygon[0]))
      .filter((flat) => flat !== undefined);

    if (!rings.length) {
      dropped += 1;
      continue;
    }

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const flat of rings) {
      for (let index = 0; index < flat.length; index += 2) {
        west = Math.min(west, flat[index]);
        east = Math.max(east, flat[index]);
        south = Math.min(south, flat[index + 1]);
        north = Math.max(north, flat[index + 1]);
      }
    }

    (regions[country] ??= []).push({
      c: code,
      n: name ?? '',
      b: [west, south, east, north],
      p: rings,
    });
    kept += 1;
  }

  const document = {
    source: SOURCE,
    licence: LICENCE,
    precision: PRECISION,
    regions,
  };

  mkdirSync(dirname(target), { recursive: true });
  const json = JSON.stringify(document);
  writeFileSync(target, `${json}\n`);

  const countries = Object.keys(regions).sort();
  process.stdout.write(
    `Wrote ${kept} regions across ${countries.length} countries ` +
      `(${(json.length / 1e6).toFixed(2)} MB), dropped ${dropped}\n` +
      `${countries.join(' ')}\n`,
  );
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
