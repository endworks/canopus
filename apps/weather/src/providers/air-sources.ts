import { Injectable } from '@nestjs/common';
import { AirReading, AirSource } from './air-source';
import { OpenMeteoAirProvider } from './open-meteo-air.provider';
import { ZaragozaAirProvider } from './zaragoza-air.provider';

/**
 * The sources, best first, and the rule for falling through them.
 *
 * Order is the whole configuration: a city's own network before a continental
 * model, because a measurement three streets away beats an interpolation from
 * eleven kilometres up. Nothing else about a source is privileged — a new one
 * is a class and a place in this list.
 *
 * Falling through is what makes the order safe. A source that does not cover
 * the cell, has no station near enough, or is simply down costs the next one
 * nothing: its failure is swallowed here rather than raised, so adding a city
 * can only ever improve the answer inside that city and can never take the air
 * away from anyone outside it.
 *
 * The two halves are asked separately — `measured` then `modelled` — because
 * the caller has something to do in between: a weather provider carrying air
 * of its own is worth asking only once the instruments have come back empty.
 * See `WeatherService.getWeather`.
 */
@Injectable()
export class AirSources {
  private readonly sources: AirSource[];

  constructor(zaragoza: ZaragozaAirProvider, openMeteo: OpenMeteoAirProvider) {
    this.sources = [zaragoza, openMeteo];
  }

  /**
   * What an instrument standing here actually measured, or nothing.
   *
   * The half worth asking first and on its own. Being measured is the one
   * thing that ranks a source above a weather provider's own air — every
   * provider that carries pollutants carries modelled ones, off the same
   * continental runs the model here reads — so an answer from this outranks
   * anything the provider could have said, and its absence is what makes
   * asking the provider worthwhile.
   *
   * Costs nothing where no network reaches: `covers` is a bounds check, so
   * outside the handful of cities with one this resolves without a request.
   */
  measured(
    latitude: number,
    longitude: number,
  ): Promise<AirReading | undefined> {
    return this.ask(true, latitude, longitude);
  }

  /** What the model says about here, or nothing. The source of last resort. */
  modelled(
    latitude: number,
    longitude: number,
  ): Promise<AirReading | undefined> {
    return this.ask(false, latitude, longitude);
  }

  /** The first source of the given kind with something to say about the cell. */
  private async ask(
    measured: boolean,
    latitude: number,
    longitude: number,
  ): Promise<AirReading | undefined> {
    for (const source of this.sources) {
      if (source.measured !== measured) continue;
      if (!source.covers(latitude, longitude)) continue;

      // Swallowed per source rather than around the whole loop: a city's feed
      // being down is exactly the case where the model behind it should still
      // answer, and a `catch` outside the loop would lose that.
      const grade = await source
        .read(latitude, longitude)
        .catch(() => undefined);
      if (grade !== undefined) return { ...grade, source };
    }
    return undefined;
  }
}
