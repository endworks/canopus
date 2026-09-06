import { IdPayload } from '@canopus/shared';

export type BiziStationPayload = IdPayload;

export interface BiziStationResponse {
  id: string;
  street: string;
  state?: string | null;
  bikes?: number | null;
  /**
   * How many of `bikes` are electric, where the road that answered breaks the
   * count down. Absent rather than nought where it does not: the city's set
   * says only how many bikes there are, and a nought here would read as a rack
   * with no electric bike on it.
   */
  electricBikes?: number | null;
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
