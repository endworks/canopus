/**
 * What the city answers for one bike rack.
 *
 * This is `aparcamiento-bicicleta` — the municipal bike parking, the stands a
 * rider locks their own bike to. It is a record of street furniture: where the
 * rack is, how many bikes fit on it, and what kind of rack it is. There are no
 * bikes of its own to count, so there is nothing here that says how many are
 * free right now, and there never will be. Whatever counts this service serves
 * come from the operator's feed.
 */
export interface BiziStationApiResponse {
  /** Numbered, and numbered as a number. */
  id: string | number;
  /** Where it stands, shouted, which is all this set names it by. */
  title?: string;
  /**
   * What kind of rack: "Abierto" for one out in the open. A description of the
   * furniture, not a state — nothing here says whether it can be used.
   */
  tipo?: string;
  /** How many bikes fit on it. */
  plazas?: number;
  /** How many stands it has, each taking a bike either side. */
  anclajes?: number;
  geometry?: {
    type?: string;
    coordinates?: number[];
  };
  icon?: string;
  about?: string;
  lastUpdated?: string;
  /**
   * The street in a field of its own. This set names the place in `title`
   * instead; the others in the family carry both, so it is read where it is
   * there.
   */
  calle?: string;
  /**
   * None of these three is in this set. They are what the retired
   * `estacion-bicicleta` carried, and they are read where a row still has
   * them so that a set which starts publishing them is served at once.
   */
  estado?: string;
  bicisDisponibles?: number;
  anclajesDisponibles?: number;
}

/** A page of them, in the envelope every one of these datasets is paged in. */
export interface BiziApiResponse {
  totalCount?: number;
  start?: number;
  rows?: number;
  result?: BiziStationApiResponse[];
}
