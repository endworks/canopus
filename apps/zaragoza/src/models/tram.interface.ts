import { IdPayload } from '@canopus/shared';
import { ServiceAlertResponse } from '../alert-store';
import { LineResponse, LinesResponse } from './line.interface';
import { StationTime } from './common.interface';

export type TramStationPayload = IdPayload;

/** An alteration, in the one shape both networks publish one. */
export type TramAlertResponse = ServiceAlertResponse;

export interface TramStationResponse {
  id: string;
  street: string;
  lines: string[];
  times?: StationTime[];
  coordinates: string[];
  source?: string;
  sourceUrl?: string;
  lastUpdated?: string;
  type?: string;
  /** The alterations in force on the lines that call at this stop. */
  alerts?: TramAlertResponse[];
}

export interface TramStationsResponse {
  [id: string]: TramStationResponse;
}

/** A line, in the one shape both networks publish one. */
export type TramLineResponse = LineResponse;

export type TramLinesResponse = LinesResponse;
