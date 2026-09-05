import { IdPayload } from '@canopus/shared';

export type BiziStationPayload = IdPayload;

export interface BiziStationResponse {
  id: string;
  street: string;
  state?: string | null;
  bikes?: number | null;
  openDocks?: number | null;
  coordinates: string[];
  source?: string;
  sourceUrl?: string;
  lastUpdated?: string;
  type?: string;
}

export interface BiziStationsResponse {
  [id: string]: BiziStationResponse;
}
