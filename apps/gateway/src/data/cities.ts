/**
 * The cities this gateway can answer for, and what it can answer about them.
 *
 * `services` is what *this API* serves for a place, which is not the same as
 * what the place has. Valencia runs a metro and a bike scheme; neither is
 * listed here, because nothing behind this gateway carries either. A client
 * reading this list is asking "what can I show somebody standing here", and
 * the honest answer is the one about our own coverage.
 *
 * `weather` is on every entry and belongs to none of them: the weather service
 * answers any coordinate on earth, so it is here to say the tab is worth
 * drawing rather than to claim the city is special. `cinema` is the other way
 * round — it is not declared here at all, but joined from the zine service,
 * which is the only thing that knows whether a billboard is actually held.
 *
 * Coordinates are the city each province is named after, and they are what a
 * client matches against. Names are not: a phone reverse-geocodes its own
 * position and gets `València` on one platform, `Valencia` on another and the
 * autonomous community on a third, and all three are the same billboard. A
 * distance has no spelling.
 */
export type CityService =
  'weather' | 'bus' | 'tram' | 'metro' | 'cinema' | 'bikes';

export type CitySeed = {
  /** The id the services take as their `location` filter. */
  id: string;
  /** What to call it on screen, in the case its own signage uses. */
  name: string;
  latitude: number;
  longitude: number;
  /** What this gateway serves for it, minus `cinema`, which zine answers. */
  services: CityService[];
};

export const cities: CitySeed[] = [
  {
    id: 'zaragoza',
    name: 'Zaragoza',
    latitude: 41.6488,
    longitude: -0.8891,
    // The city the transport service is about: buses, the tram, and Bizi.
    services: ['weather', 'bus', 'tram', 'bikes'],
  },
  {
    id: 'huesca',
    name: 'Huesca',
    latitude: 42.1401,
    longitude: -0.4089,
    services: ['weather'],
  },
  {
    id: 'teruel',
    name: 'Teruel',
    latitude: 40.3456,
    longitude: -1.1065,
    services: ['weather'],
  },
  {
    id: 'valencia',
    name: 'Valencia',
    latitude: 39.4699,
    longitude: -0.3763,
    services: ['weather'],
  },
];
