import { IdPayload } from '@canopus/shared';
import { StationTime } from './common.interface';

export type TramStationPayload = IdPayload;

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
}

export interface TramStationsResponse {
  [id: string]: TramStationResponse;
}
