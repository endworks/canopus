import { CityService } from '../data/cities';

/**
 * One city this gateway can answer for, and what it can answer about it.
 *
 * For a client that knows its own coordinates and not what the place it is
 * standing in is called. Matching a reverse-geocoded name against a
 * catalogue's spelling is the thing that cannot be made to work — a phone says
 * `València`, the catalogue says `Valencia`, and another platform names the
 * autonomous community instead — so what travels is a point, and the caller
 * picks whichever city is nearest.
 *
 * `services` is what this API serves for the place, not what the place has.
 * Valencia runs a metro and a bike scheme and neither is listed, because
 * nothing behind this gateway carries either.
 */
export class City {
  /**
   * The id the services take as their `location` filter.
   * @example 'zaragoza'
   */
  id: string;

  /**
   * What to call it on screen.
   * @example 'Zaragoza'
   */
  name: string;

  /**
   * Latitude of the city the province is named after.
   * @example 41.6488
   */
  latitude: number;

  /**
   * Longitude of the same.
   * @example -0.8891
   */
  longitude: number;

  /**
   * What can be shown to somebody standing here.
   *
   * `weather` is on every city — that service answers any coordinate, so it
   * says the panel is worth drawing rather than that the city is special.
   * `cinema` is present only where the zine service actually holds a
   * billboard, so a city never advertises a tab that opens on nothing.
   *
   * @example ['weather', 'bus', 'tram', 'bikes', 'cinema']
   */
  services: CityService[];
}
