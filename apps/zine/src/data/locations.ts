/**
 * The places this service files cinemas under.
 *
 * `location` on a cinema is a province — the Monzón venue is filed under
 * Huesca, a hundred and thirty kilometres from Huesca itself — so this is the
 * vocabulary of the filter rather than a map of anywhere. Where these places
 * are, and what else can be had in them, is the gateway's catalogue to keep: a
 * cinema service knows which billboards it holds and nothing about buses.
 */
export type CinemaLocationSeed = {
  /** The `location` value a cinema carries, lowercased, as the filter takes it. */
  id: string;
  /** What to call it on screen, in the case its own signage uses. */
  name: string;
};

export const locations: CinemaLocationSeed[] = [
  { id: 'zaragoza', name: 'Zaragoza' },
  { id: 'huesca', name: 'Huesca' },
  { id: 'teruel', name: 'Teruel' },
  { id: 'valencia', name: 'Valencia' },
];
