import { IdPayload, StationTime } from './common.interface';

export interface BusStationPayload extends IdPayload {
  source: string;
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
  hidden: boolean;
  lastUpdated: string;
}

export interface BusLinesResponse {
  [id: string]: BusLineResponse;
}
