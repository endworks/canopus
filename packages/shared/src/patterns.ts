/**
 * RPC message patterns — the single source of truth for the gateway<->service
 * wire. The string VALUES are the protocol: the gateway's `client.send(...)` and
 * the owning service's `@MessagePattern(...)` must use the same constant, so a
 * rename is a compile error instead of a silent runtime timeout.
 */

export const ZARAGOZA_PATTERNS = {
  busStations: 'bus/stations',
  busStation: 'bus/station',
  busLines: 'bus/lines',
  busLine: 'bus/line',
  busLinesUpdate: 'bus/lines/update',
  busAlerts: 'bus/alerts',
  tramStations: 'tram/stations',
  tramStation: 'tram/station',
  biziStations: 'bizi/stations',
  biziStation: 'bizi/station',
  biziStationsUpdate: 'bizi/stations/update',
  places: 'places',
  place: 'place',
  taxis: 'taxis',
} as const;

export const ZINE_PATTERNS = {
  cinemas: 'cinemas',
  locations: 'locations',
  cinema: 'cinema',
  cinemaBasic: 'cinema/basic',
  movies: 'movies',
  cached: 'cached',
  prune: 'prune',
  updateAll: 'updateAll',
} as const;

export const WEATHER_PATTERNS = {
  weather: 'weather',
  providers: 'providers',
} as const;

export const RAE_PATTERNS = {
  search: 'search',
} as const;

export const TWITTER_PATTERNS = {
  getMediaUrls: 'getMediaUrls',
} as const;
