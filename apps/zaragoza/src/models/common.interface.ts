export interface StationBase {
  id: string;
  street: string;
  coordinates: string[];
}

export interface StationTime {
  destination: string;
  line: string;
  time: string;
}

export interface ValueLabel {
  value: string;
  label: string;
}
