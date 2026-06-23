export class StationTime {
  /**
   * Destination shown for this arrival.
   * @example 'Parque Goya'
   */
  destination: string;

  /**
   * Line serving this arrival.
   * @example '23'
   */
  line: string;

  /**
   * ETA text as published by the source.
   * @example '5 min.'
   */
  time: string;
}

/** A bus or tram station (both services return the same shape). */
export class Station {
  /**
   * Station id (the map key).
   * @example 'tuzsa-1'
   */
  id: string;

  /**
   * Street / location name.
   * @example 'Gran Vía'
   */
  street: string;

  /**
   * Lines serving the station.
   * @example ['23', '38']
   */
  lines: string[];

  /** Upcoming arrivals, when available. */
  times?: StationTime[];

  /**
   * `[longitude, latitude]` as strings.
   * @example ['-0.8891', '41.6488']
   */
  coordinates: string[];

  /**
   * Where the data came from.
   * @example 'api'
   */
  source?: string;

  /**
   * URL the data was scraped from.
   * @example 'https://www.zaragoza.es/sede/servicio/...'
   */
  sourceUrl?: string;

  /**
   * ISO timestamp of the last update.
   * @example '2026-06-23T12:00:00.000Z'
   */
  lastUpdated?: string;

  /**
   * Station type.
   * @example 'bus'
   */
  type?: string;
}

export class BusLine {
  /**
   * Line id.
   * @example '23'
   */
  id: string;

  /**
   * Line name / route.
   * @example 'Parque Goya - Rosales del Canal'
   */
  name: string;

  /**
   * Line colour (hex), when known.
   * @example '#E30613'
   */
  color?: string;

  /**
   * Station ids along the outbound direction.
   * @example ['tuzsa-1', 'tuzsa-2']
   */
  stations: string[];

  /**
   * Station ids along the return direction.
   * @example ['tuzsa-2', 'tuzsa-1']
   */
  stationsReturn?: string[];

  /**
   * Whether the line is hidden from listings.
   * @example false
   */
  hidden: boolean;

  /**
   * ISO timestamp of the last update.
   * @example '2026-06-23T12:00:00.000Z'
   */
  lastUpdated: string;
}

export class BiziStation {
  /**
   * Station id.
   * @example '001'
   */
  id: string;

  /**
   * Street / location name.
   * @example 'Plaza del Pilar'
   */
  street: string;

  /**
   * Operational state, when reported.
   * @example 'IN_SERVICE'
   */
  state?: string | null;

  /**
   * Available bikes, when reported.
   * @example 7
   */
  bikes?: number | null;

  /**
   * Free docks, when reported.
   * @example 12
   */
  openDocks?: number | null;

  /**
   * `[longitude, latitude]` as strings.
   * @example ['-0.8773', '41.6561']
   */
  coordinates: string[];

  /**
   * Where the data came from.
   * @example 'api'
   */
  source?: string;

  /**
   * URL the data was scraped from.
   * @example 'https://www.zaragoza.es/sede/servicio/...'
   */
  sourceUrl?: string;

  /**
   * ISO timestamp of the last update.
   * @example '2026-06-23T12:00:00.000Z'
   */
  lastUpdated?: string;

  /**
   * Station type.
   * @example 'bizi'
   */
  type?: string;
}
