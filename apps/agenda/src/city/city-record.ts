/**
 * The city's event record, as `cultura/evento/list.json?srsname=wgs84` sends
 * it. Only the fields the agenda reads; the rest is kept in `raw_records`.
 *
 * Its dates are local and carry no offset ("2026-12-05T00:00:00"), and the
 * times of day are in `openingHours`, by weekday, in Spanish.
 */
export interface CityLocation {
  id?: number;
  title?: string;
  streetAddress?: string;
  postalCode?: string;
  junta?: string;
  addressLocality?: string;
  telephone?: string;
  email?: string;
  geometry?: { type?: string; coordinates?: [number, number] };
}

export interface CityOpeningHours {
  dayOfWeek?: string;
  startTime?: string;
  endTime?: string;
}

export interface CitySubEvent {
  id?: number;
  location?: CityLocation;
  startDate?: string;
  endDate?: string;
  openingHours?: CityOpeningHours[];
}

export interface CityEvent {
  id: number;
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  subEvent?: CitySubEvent[];
  category?: { id?: number; title?: string }[];
  type?: string;
  population?: { id?: number; title?: string }[];
  program?: { id?: number; title?: string };
  portales?: { portal?: { id?: number; title?: string; code?: string } }[];
  price?: {
    fareGroup?: string;
    hasCurrencyValue?: number;
    hasCurrency?: string;
  }[];
  priceComment?: string;
  url?: string;
  image?: string;
  minAge?: number | string;
  maxAge?: number | string;
  location?: string;
  geometry?: { coordinates?: [number, number] };
  registration?: { url?: string; description?: string };
  performer?: string;
}

/** A museum, from `equipamiento/list.json?q=category.title==Museos`. */
/** One of the city's monuments, `/sede/servicio/monumento`: its texts are HTML. */
export interface CityMonument {
  id: number | string;
  title?: string;
  address?: string;
  description?: string;
  horario?: string;
  price?: string;
  phone?: string;
  image?: string;
  estilo?: string;
  datacion?: string;
  /** The city's own pick of the ones worth a visit. */
  top?: boolean;
  uri?: string;
  geometry?: { coordinates?: [number, number] };
}

export interface CityFacility {
  id: number | string;
  title?: string;
  calle?: string;
  postalCode?: string;
  junta?: string;
  horario?: string;
  precio?: string;
  url?: string;
  email?: string;
  tel?: { tel?: string };
  geometry?: { coordinates?: [number, number] };
}
