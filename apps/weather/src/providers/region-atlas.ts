import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { CELL } from '../utils';

/** One warning region: its code, its name, its bounds and its outer rings. */
interface Region {
  c: string;
  n: string;
  /** [west, south, east, north], for rejecting a region without walking it. */
  b: [number, number, number, number];
  /** Outer rings, flattened to [x, y, x, y, …]. */
  p: number[][];
}

interface Atlas {
  source: string;
  licence: string;
  regions: Record<string, Region[]>;
}

const ATLAS = join(__dirname, '..', 'data', 'meteoalarm-regions.json');

/**
 * Which warning regions a cell falls in.
 *
 * MeteoAlarm scopes a warning by region code and ships no geometry for those
 * codes — the feeds carry none, and the API that does is behind a token handed
 * out by email — so the codes alone cannot say whether a national warning is
 * about the caller's own valley. This is the atlas that answers that, built
 * from the public MIT-licensed one by `scripts/build-regions.mjs`.
 *
 * It only knows `EMMA_ID` codes, which is what most of the feed uses. France
 * and Romania scope by `NUTS3`, Ireland by `FIPS`, and Norway and Sweden by
 * nothing at all; for those the lookup comes back empty and the warnings stay
 * national, which the response says out loud rather than quietly narrowing to
 * nothing.
 */
@Injectable()
export class RegionAtlas {
  private atlas?: Atlas;

  /** Read once, on the first request that needs it rather than at boot. */
  private load(): Atlas {
    this.atlas ??= JSON.parse(readFileSync(ATLAS, 'utf8')) as Atlas;
    return this.atlas;
  }

  /**
   * The codes of every region the cell touches.
   *
   * Empty means the atlas cannot place this cell — a country it does not
   * cover, or a point that landed off every region — and never that no warning
   * applies. Narrowing to nothing on a lookup that failed would turn a missing
   * map into an all-clear, so the caller treats empty as "cannot narrow".
   *
   * The cell's corners are tested along with its middle. A cell is eleven
   * kilometres across and regions meet inside one all the time; a town on the
   * far side of the cell from its centre should not lose the warning that
   * covers it, and over-including a neighbour's warning is the safe way to be
   * wrong about the weather.
   */
  covering(country: string, latitude: number, longitude: number): string[] {
    const regions = this.load().regions[country.toUpperCase()];
    if (!regions) return [];

    const half = CELL / 2;
    const points: [number, number][] = [
      [longitude, latitude],
      [longitude - half, latitude - half],
      [longitude - half, latitude + half],
      [longitude + half, latitude - half],
      [longitude + half, latitude + half],
    ];

    return regions
      .filter((region) => points.some(([x, y]) => this.inside(region, x, y)))
      .map((region) => region.c);
  }

  /**
   * Which country a point is in, out of the ones the atlas holds.
   *
   * The same geometry as `covering`, asked the other way round: that one is
   * given a country and narrows to regions, this one is given nothing and
   * finds the country. Both are needed because a coordinate does not carry a
   * country and two things downstream want one — MeteoAlarm, to pick a
   * national feed, and WeatherKit, which returns no warnings at all unless it
   * is told which government's warnings are wanted.
   *
   * The exact point only, with none of `covering`'s corner spreading. Widening
   * a lookup for regions is the safe way to be wrong — an extra neighbouring
   * warning — but widening this one means answering France for a cell in
   * Spain, and that is a whole country's warnings for the wrong country. A
   * point on the border resolves to whichever ring claims it, and both claim
   * the border, so the first is as good as the second.
   *
   * `undefined` where the atlas cannot place it: at sea, or in one of the
   * countries it does not hold. It covers the thirty-five MeteoAlarm
   * participates in, so a caller in Peru gets nothing from this and has to say
   * where they are — which is what `country` on the request is for.
   */
  locate(latitude: number, longitude: number): string | undefined {
    for (const [country, regions] of Object.entries(this.load().regions)) {
      if (regions.some((region) => this.inside(region, longitude, latitude))) {
        return country;
      }
    }
    return undefined;
  }

  /**
   * Whether the atlas speaks the same codes this country's feed does.
   *
   * It has to be asked, because holding regions for a country is not the same
   * as being able to place its warnings. The atlas is an `EMMA_ID` map, and
   * France scopes its warnings by `NUTS3` while still having French regions in
   * here under codes of the other kind: filtering one namespace by the other
   * matches nothing, and would answer a caller in Marseille with an empty list
   * of warnings that it called narrowed. An empty list has to mean "nothing is
   * in force", never "the map was in the wrong language".
   */
  names(country: string, codes: string[]): string[] {
    const regions = this.load().regions[country.toUpperCase()] ?? [];
    const wanted = new Set(codes);
    return regions
      .filter((region) => wanted.has(region.c))
      .map((region) => region.n);
  }

  speaks(country: string, codes: string[]): boolean {
    const regions = this.load().regions[country.toUpperCase()];
    if (!regions?.length || !codes.length) return false;
    const known = new Set(regions.map((region) => region.c));
    return codes.some((code) => known.has(code));
  }

  private inside(region: Region, x: number, y: number): boolean {
    const [west, south, east, north] = region.b;
    if (x < west || x > east || y < south || y > north) return false;
    return region.p.some((ring) => this.withinRing(ring, x, y));
  }

  /**
   * Ray casting over a flattened ring.
   *
   * Counts the edges a ray east of the point crosses; an odd count is inside.
   * The rings are outer rings only, so a region with a hole in it answers yes
   * for the hole as well — see the note in the generator about which direction
   * it is safe to be wrong in.
   */
  private withinRing(ring: number[], x: number, y: number): boolean {
    let inside = false;
    for (
      let index = 0, previous = ring.length - 2;
      index < ring.length;
      previous = index, index += 2
    ) {
      const xi = ring[index];
      const yi = ring[index + 1];
      const xj = ring[previous];
      const yj = ring[previous + 1];

      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Where the atlas came from, for the credit the response carries. */
  get source(): string {
    return this.load().source;
  }
}
