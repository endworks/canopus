/**
 * A source of air, graded by the one table.
 *
 * There was one of these and it needed no abstraction: Open-Meteo answers
 * every coordinate on earth, so "the air" and "Open-Meteo" were the same
 * sentence. A city's own monitoring network breaks that — it answers eight
 * points and nowhere else — and the moment a second source exists the response
 * has to be able to say which one spoke, because the credit line is different
 * and the reader is owed it.
 *
 * What is deliberately *not* on here is a grade. Every source answers
 * concentrations and `european-aqi` turns them into an index, so that a station
 * in Zaragoza and a model cell over Buenos Aires cannot disagree about what
 * band 3 means. See `european-aqi` for why that is worth the indirection.
 */
export abstract class AirSource {
  abstract readonly name: string;
  abstract readonly url: string;
  /** The licence or reuse terms the source asks be linked, where it asks. */
  abstract readonly licence?: string;
  /**
   * The words the source requires shown, where it requires particular ones.
   * See `Attribution.notice`: absent means its `name` is credit enough.
   */
  abstract readonly notice?: string;

  /**
   * Whether an instrument stood where this reading is about.
   *
   * The one thing that ranks a source above a weather provider's own air. Every
   * provider that carries pollutants carries modelled ones, off the same
   * continental runs Open-Meteo reads, so a second model has nothing to offer
   * one that already answered — but a station three streets away does, and it
   * is worth asking about before the provider is asked at all. See
   * `AirSources.measured`.
   */
  abstract readonly measured: boolean;

  /**
   * Whether this source could speak for the cell at all.
   *
   * Cheap and synchronous by contract: it is asked of every source on every
   * request, so it may not do I/O. A source with a network — a city, a country
   * — answers from its own geography; a global model answers true and the
   * question costs nothing.
   *
   * "Could" rather than "will". A cell inside Zaragoza still has no answer if
   * it is four kilometres from the nearest station, and that is `read`'s to
   * discover, because only `read` has the stations in hand.
   */
  abstract covers(latitude: number, longitude: number): boolean;

  /** The grade here, or nothing — which is not the same as clean air. */
  abstract read(
    latitude: number,
    longitude: number,
  ): Promise<AirGrade | undefined>;
}

/** What a source answers: the number, and anything it owes alongside it. */
export interface AirGrade {
  /** European Air Quality Index, 1 (good) to 6 (extremely poor). */
  index: number;
  /**
   * A statement this source requires published alongside this reading.
   *
   * Separate from `notice` because it is a separate obligation and a client
   * places it differently — see `Attribution.disclaimer`. A credit says who the
   * data came from; this says something about the arrangement that the source
   * insists a reader be told.
   *
   * On the reading rather than on the source, which is the part worth pausing
   * over: most of what a licence demands is fixed, but Ley 37/2007 asks a
   * Spanish public body's reuser for two things at once — that the body be
   * said not to endorse the reuse, and that the date the data was last updated
   * be given. The second changes with every reading. A field that held only
   * the fixed half would be a statement that satisfies half a licence, so the
   * whole statement is composed where the date is known.
   */
  disclaimer?: string;
}

/** The grade, and who is owed the credit for it. */
export interface AirReading extends AirGrade {
  /** The source that actually answered, for its line in `attribution`. */
  source: AirSource;
}
