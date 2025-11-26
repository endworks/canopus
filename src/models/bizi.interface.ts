import { IdPayload } from './common.interface';

export interface BiziStationPayload extends IdPayload {
  source: string;
}

export interface BiziStationResponse {
  id: string;
  street: string;
  state?: string | null;
  availableBikes?: number | null;
  availableDocks?: number | null;
  coordinates: string[];
  source?: string;
  sourceUrl?: string;
  lastUpdated?: string;
  type?: string;
}

export interface BiziStationsResponse {
  [id: string]: BiziStationResponse;
}
