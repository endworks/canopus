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
 */
@Injectable()
export class AirSources {
  private readonly sources: AirSource[];

  constructor(zaragoza: ZaragozaAirProvider, openMeteo: OpenMeteoAirProvider) {
    this.sources = [zaragoza, openMeteo];
  }

  /**
   * The best air on offer here, or nothing.
   *
   * `hasOwn` says the weather provider already answered with pollutants of its
   * own, and it makes this a narrower question: not "who can tell us about this
   * cell" but "can anyone do better than the model that already did". Only a
   * measured source can, so the loop stops at the first modelled one — which,
   * because the sources are ordered best first, costs no call at all anywhere a
   * city network does not reach.
   */
  async read(
    latitude: number,
    longitude: number,
    hasOwn = false,
  ): Promise<AirReading | undefined> {
    for (const source of this.sources) {
      // Ordered best first, so the first modelled source is where the ranking
      // stops being able to beat a provider's own modelled air.
      if (hasOwn && !source.measured) return undefined;
      if (!source.covers(latitude, longitude)) continue;

      // Swallowed per source rather than around the whole loop: a city's feed
      // being down is exactly the case where the model behind it should still
      // answer, and a `catch` outside the loop would lose that.
      const index = await source
        .read(latitude, longitude)
        .catch(() => undefined);
      if (index !== undefined) return { index, source };
    }
    return undefined;
  }
}
