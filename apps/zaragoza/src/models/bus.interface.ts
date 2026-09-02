import { IdPayload } from '@canopus/shared';
import { StationTime } from './common.interface';

export interface BusStationPayload extends IdPayload {
  source: string;
}

export interface BusAlertResponse {
  id: string;
  title: string;
  url: string;
  /** The day the alteration was announced. */
  date?: string;
  /** When it runs, when the article says so. */
  startDate?: string;
  endDate?: string;
  lines: string[];
  /** The stops the alert names; empty when it names none. */
  stations: string[];
  /**
   * Provisional stops the alteration puts on, named as the article writes
   * them rather than by id — they are in no route file. Empty for most.
   */
  addedStations: string[];
  /**
   * `'stations'` when only `stations` are affected and the rest of the route
   * runs as usual; `'line'` when every stop of every line named is.
   */
  scope: 'stations' | 'line';
  /**
   * Only in a station's own alerts: the article names this stop, rather than
   * just a line that serves it. Absent from the alert list.
   */
  direct?: boolean;
}

export interface BusStationResponse {
  id: string;
  street: string;
  lines: string[];
  times?: StationTime[];
  coordinates: string[];
  source?: string;
  sourceUrl?: string;
  lastUpdated?: string;
  type?: string;
  /** The alterations in force on the lines that serve this stop. */
  alerts?: BusAlertResponse[];
}

export interface BusStationsResponse {
  [id: string]: BusStationResponse;
}

export interface BusLineResponse {
  id: string;
  name: string;
  color?: string;
  stations: string[];
  stationsReturn?: string[];
  /**
   * The shape each leg traces, `[longitude, latitude]` pairs in route order.
   *
   * Only on one line asked for by id. The listing of every line leaves them
   * out — see `toLineResponse` — so a reader that wants to draw a route asks
   * for that line.
   */
  path?: number[][];
  pathReturn?: number[][];
  /** Withdrawn, or with no route to draw. Derived, never stored. */
  hidden: boolean;
  lastUpdated: string;
}

export interface BusLinesResponse {
  [id: string]: BusLineResponse;
}
