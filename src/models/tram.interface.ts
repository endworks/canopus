import { IdPayload, StationTime } from './common.interface';

export interface TramStationPayload extends IdPayload {
  source: string;
}

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
