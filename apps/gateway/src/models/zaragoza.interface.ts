export class StationTime {
  destination: string;
  line: string;
  time: string;
}

/** A bus or tram station (both services return the same shape). */
export class Station {
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

export class BusLine {
  id: string;
  name: string;
  color?: string;
  stations: string[];
  stationsReturn?: string[];
  hidden: boolean;
  lastUpdated: string;
}

export class BiziStation {
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
