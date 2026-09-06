/**
 * What the city answers for one Bizi station.
 *
 * The fields are the city's own, in its own language, as its published schema
 * for `estacion-bicicleta` gives them. Every one of them is optional here and
 * nothing reads a field without saying what to do when it is missing: the
 * schema names a shape, not a guarantee that every row fills it in.
 */
export interface BiziStationApiResponse {
  /** Numbered, and numbered as a number in some of these sets. */
  id?: string | number;
  /** The station's own URL in the city's catalogue. */
  about?: string;
  /** Names the station, with the street behind a dash. */
  title?: string;
  estado?: string;
  /** A second state field. Read only where `estado` says nothing. */
  estadoEstacion?: string;
  address?: string;
  tipoEquipamiento?: string;
  bicisDisponibles?: number;
  anclajesDisponibles?: number;
  geometry?: {
    type?: string;
    coordinates?: number[];
  };
  lastUpdated?: string;
  description?: string;
  descripcion?: string;
  icon?: string;
  /** Carried by the sibling sets in this family, which name the street. */
  calle?: string;
}

/** A page of them, in the envelope every one of these datasets is paged in. */
export interface BiziApiResponse {
  totalCount?: number;
  start?: number;
  rows?: number;
  result?: BiziStationApiResponse[];
}
