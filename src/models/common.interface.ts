export interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
}

export interface StationTime {
  destination: string;
  line: string;
  time: string;
}

export interface LineGeometry {
  link?: string;
  about?: string;
  title?: string;
  description?: string;
  geometry: {
    type: string;
    coordinates: string[];
  };
}

export interface IdPayload {
  id: string;
}
