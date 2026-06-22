export interface BiziApiResponse {
  totalCount: number;
  start: number;
  rows: number;
  result: Array<{
    id: string;
    title: string;
    estado: string;
    bicisDisponibles: number;
    anclajesDisponibles: number;
    geometry: {
      type: string;
      coordinates: number[];
    };
    lastUpdated: string;
    about?: string;
  }>;
}

export interface BiziStationApiResponse {
  id: string;
  title: string;
  estado: string;
  bicisDisponibles: number;
  anclajesDisponibles: number;
  geometry: {
    type: string;
    coordinates: number[];
  };
  lastUpdated: string;
  about?: string;
  address?: string;
  estadoEstacion?: string;
  tipoEquipamiento?: string;
  description?: string;
  descripcion?: string;
  icon?: string;
}
