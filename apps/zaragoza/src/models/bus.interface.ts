import { IdPayload } from '@canopus/shared';
import { ServiceAlertResponse } from '../alert-store';
import { LineResponse, LinesResponse } from './line.interface';
import { StationTime } from './common.interface';

export interface BusStationPayload extends IdPayload {
  source: string;
}

/** An alteration, in the one shape both networks publish one. */
export type BusAlertResponse = ServiceAlertResponse;

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
  /** The alterations in force that name this stop. */
  alerts?: BusAlertResponse[];
}

export interface BusStationsResponse {
  [id: string]: BusStationResponse;
}

/** A line, in the one shape both networks publish one. */
export type BusLineResponse = LineResponse;

export type BusLinesResponse = LinesResponse;
