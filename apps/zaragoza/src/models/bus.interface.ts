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
  /** The stops the article names one by one; empty when it names none. */
  stations: string[];
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
  /** Withdrawn, or with no route to draw. Derived, never stored. */
  hidden: boolean;
  lastUpdated: string;
}

export interface BusLinesResponse {
  [id: string]: BusLineResponse;
}
