/**
 * What the city answers for a bike rack.
 *
 * This is the `equipamiento` envelope — the same one the taxi ranks and the
 * chemists arrive in, and read the same way. That matters for the counts: an
 * equipment record says where a rack is and how big it is, and the two count
 * fields are optional here because a dataset of physical racks need not carry
 * how many bikes are standing in one right now. Where they are absent the
 * counts come from the operator's feed, or from nowhere.
 */
export interface BiziStationApiResponse {
  id: string | number;
  title?: string;
  /** The street. Named for the field, which is what the city calls it. */
  calle?: string;
  estado?: string;
  bicisDisponibles?: number;
  anclajesDisponibles?: number;
  /** How many stands the rack has, where the city publishes it. */
  plazas?: number;
  geometry?: {
    type?: string;
    coordinates?: number[];
  };
  lastUpdated?: string;
  about?: string;
  address?: string;
  estadoEstacion?: string;
  tipoEquipamiento?: string;
  description?: string;
  descripcion?: string;
  icon?: string;
}

/** A page of them, in the envelope every one of these datasets is paged in. */
export interface BiziApiResponse {
  totalCount?: number;
  start?: number;
  rows?: number;
  result?: BiziStationApiResponse[];
}
