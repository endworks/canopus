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

/** A service alteration published by the operator. */
export class ServiceAlert {
  /**
   * Alert id, the slug of the article it links to.
   * @example 'fiestas-en-miralbueno-afecciones-en-el-bus-urbano'
   */
  id: string;

  /**
   * Headline as published.
   * @example 'Fiestas en Miralbueno – Afecciones en el bus urbano'
   */
  title: string;

  /**
   * The article explaining the alteration.
   * @example 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno-afecciones-en-el-bus-urbano/'
   */
  url: string;

  /**
   * The day it was announced. When the article gives no end date, the alert is
   * dropped a week after this rather than when the alteration is over.
   * @example '2026-08-24'
   */
  date?: string;

  /**
   * When the alteration runs, as read from the article it links to. An alert
   * with an `endDate` is shown until that day and no longer.
   * @example '2026-08-24'
   */
  startDate?: string;

  /** @example '2026-08-26' */
  endDate?: string;

  /**
   * Lines the alert names. Ids the network does not list are kept as
   * published, so an event line still carries its alteration.
   * @example ['21', '52', '53']
   */
  lines: string[];

  /**
   * The stops the alert affects, resolved from the notice against the routes
   * of the lines it names. Empty where none could be established.
   * @example ['1234', '1235']
   */
  stations: string[];

  /**
   * `'stations'` when only those stops are affected and the rest of each
   * route runs as usual — the alert is then shown at those stops alone.
   * `'line'` when every stop of every line named is affected, which is also
   * where an unread notice and a doubtful one land.
   * @example 'line'
   */
  scope: 'stations' | 'line';

  /**
   * Only in a station's own `alerts`: the notice names this stop, rather than
   * just a line that serves it. Lead with these; the rest are the line's.
   * @example true
   */
  direct?: boolean;
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

  /**
   * Alterations in force on the lines that serve this stop. Bus stops only:
   * matching is by line, so an alert reaches every stop of a named line.
   */
  alerts?: ServiceAlert[];
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
   * Whether the line is hidden from listings: it was withdrawn, or there is
   * no route to draw for it.
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
