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
  tramLines: 'tram/lines',
  tramLine: 'tram/line',
  tramLinesUpdate: 'tram/lines/update',
  tramAlerts: 'tram/alerts',
  biziStations: 'bizi/stations',
  biziStation: 'bizi/station',
  biziStationsUpdate: 'bizi/stations/update',
  places: 'places',
  place: 'place',
  taxis: 'taxis',
} as const;

/**
 * The roads to one station's arrivals, in the order they are walked.
 *
 * Here rather than in either end of the wire because the gateway documents
 * them, the caller picks one by name, and the service branches on them: three
 * places that have to agree, and did not while each spelled the union out.
 */
export const STATION_SOURCES = ['api', 'web', 'backup'] as const;

export type StationSource = (typeof STATION_SOURCES)[number];

/** The city's point sets, named the way a caller asks for them. */
export const PLACE_KINDS = ['taxi-rank', 'taxi-office', 'pharmacy'] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

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

/**
 * The push service's wire.
 *
 * Deliberately not "arrivals": what this service owns is a device, what it
 * wants from that device is which kinds of thing it may say to it, and a
 * followed departure is the first producer to use that — not the shape of the
 * whole thing. A promotion or an event notice later is another producer and no
 * new registry.
 */
export const PUSH_PATTERNS = {
  /** A device says hello, or says its token has changed. */
  registerDevice: 'push/devices/register',
  /** Which categories that device wants to hear about. */
  setPreferences: 'push/devices/preferences',
  /** The device is gone, or the reader has turned everything off. */
  forgetDevice: 'push/devices/forget',
  /** Follow one departure: the countdown the server now keeps honest. */
  follow: 'push/follows/create',
  /** A new Live Activity token for a follow already running. */
  refreshFollow: 'push/follows/refresh',
  /**
   * Read this follow's stop now and push what it says.
   *
   * What the button on a Lock Screen countdown asks for. The app could read
   * the board itself, and used to: the reason it does not is that two things
   * writing one countdown is how a reader ends up watching it jump when they
   * open the app. Whoever is keeping the countdown is the one who changes it.
   */
  announceFollow: 'push/follows/announce',
  /** Stop following. */
  unfollow: 'push/follows/delete',
} as const;

/** Which store a device came from, and therefore which road a push takes. */
export const PUSH_PLATFORMS = ['ios', 'android'] as const;

export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/**
 * What a device may be told about.
 *
 * `arrivals` is transactional — the reader asked for a particular bus and this
 * is the answer to it. The other two are messages somebody at this end decided
 * to send, which is a different thing in every way that matters: they are off
 * until they are asked for, they are recorded as consented to, and they are
 * sent with a credential the app does not hold.
 */
export const PUSH_CATEGORIES = ['arrivals', 'promotions', 'events'] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** A device registering itself, or saying what changed about it. */
export interface RegisterDevicePayload {
  /** The bundle or package this install is of. One service, several apps. */
  app: string;
  platform: PushPlatform;
  /**
   * How this device is addressed: an APNs device token on iOS, an FCM
   * registration token on Android.
   */
  token: string;
  /** The words it wants to be spoken to in. */
  locale?: string;
  /**
   * ActivityKit's device-level push-to-start token, where the reader is on a
   * version that has one: what lets a countdown be started without the app.
   */
  pushToStartToken?: string;
  /** Set on the first registration; afterwards `setPreferences` moves them. */
  categories?: PushCategory[];
}

export interface SetPreferencesPayload {
  app: string;
  token: string;
  categories: PushCategory[];
}

export interface ForgetDevicePayload {
  app: string;
  token: string;
}

/** One departure, followed. */
export interface FollowPayload {
  app: string;
  platform: PushPlatform;
  /** The device this belongs to, as registered. */
  token: string;
  /**
   * The Live Activity's own push token, iOS only: a push addressed to the
   * activity rather than to the phone. Without one this is a follow that can
   * only be answered with an ordinary notification.
   */
  activityToken?: string;
  /** `bus` or `tram`, and the stop the operator knows. */
  kind: string;
  stopId: string;
  /** The pin's key, `bus:720`, for the client to route a tap by. */
  stopKey: string;
  stopName: string;
  line: string;
  destination: string;
  /**
   * The row the reader actually picked, as the instant it is due — Unix epoch
   * SECONDS — and the operator's own words for it.
   *
   * The operator publishes two of each line and a reader may be waiting for
   * the second, so which one was tapped is a fact only the app holds. Without
   * it this end anchors on the soonest row and follows the bus in front of
   * theirs. Optional because a client that does not send it is still followed,
   * on the soonest row, which is what every build before this one did.
   */
  anchor?: number;
  words?: string;
  locale?: string;
}

export interface RefreshFollowPayload {
  id: string;
  activityToken: string;
}

export interface UnfollowPayload {
  id: string;
}

export interface AnnounceFollowPayload {
  id: string;
}

/** What the service says back about a follow it has taken on. */
export interface FollowResponse {
  id: string;
  /** When it stops watching by itself, whatever else happens. */
  expiresAt: string;
}
