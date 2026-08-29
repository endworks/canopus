import { Injectable } from '@nestjs/common';
import { cities, CityService } from '../data/cities';
import { City } from '../models/cities.interface';
import { ZineService } from './zine.service';

/** What zine answers about the places it files cinemas under. */
type CinemaLocation = { id: string; cinemas: number };

/**
 * The cities this gateway can answer for, and what it can answer about them.
 *
 * The catalogue is static and the cinema line is not: whether a billboard is
 * actually held is the zine service's own business, and a city whose last
 * venue closed should stop advertising a tab that opens on nothing. So the two
 * are joined here rather than written down twice.
 *
 * A zine that will not answer costs the `cinema` line and nothing else. The
 * rest of a city's services do not depend on it, and a catalogue that refused
 * to answer at all because one backend was down would take the whole feature
 * off every client at once.
 */
@Injectable()
export class CitiesService {
  constructor(private readonly zine: ZineService) {}

  async getCities(): Promise<City[]> {
    const billboards = await this.zine
      .getLocations()
      .then((locations) => locations as CinemaLocation[])
      .catch(() => [] as CinemaLocation[]);

    const showing = new Set(
      billboards.filter((place) => place.cinemas > 0).map((place) => place.id),
    );

    return cities.map((city) => ({
      ...city,
      services: [
        ...city.services,
        ...((showing.has(city.id) ? ['cinema'] : []) as CityService[]),
      ],
    }));
  }
}
