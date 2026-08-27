/**
 * Apple's word for the sky, in the two spellings the response already uses.
 *
 * WeatherKit answers with a `conditionCode` — `MostlyClear`, `WintryMix` — and
 * with nothing else about the sky: no icon, no number, and no translation. The
 * `{language}` in the URL localises the warnings and not this. So the three
 * fields the response contract asks for have to be made here, from the one
 * field Apple sends.
 *
 * The number is OpenWeather's, deliberately. `current.condition` is documented
 * as the provider's own condition id, and had this shipped Apple's string in a
 * numeric field it would have been a second vocabulary for clients to learn to
 * draw. Mapping onto the ids a client already switches on means an Apple
 * reading renders with the icon set it already has. It is lossy in one
 * direction only — several Apple codes land on one OpenWeather id — and never
 * wrong about the weather.
 */
export interface AppleCondition {
  /** The nearest OpenWeather condition id, for a client already drawing those. */
  id: number;
  /** The OpenWeather icon code without its day/night suffix. */
  icon: string;
  /** English, because Apple sends no other. See the note on `describe`. */
  description: string;
}

/**
 * Every value of Apple's `WeatherCondition`, as the REST API spells it.
 *
 * The REST API documents `conditionCode` as "an enumeration value" and lists
 * none of them; the values are the Swift `WeatherCondition` cases in leading
 * caps. All thirty-four are here so that an unknown code means Apple added one,
 * rather than meaning this table was never finished.
 */
export const CONDITIONS: Record<string, AppleCondition> = {
  Clear: { id: 800, icon: '01', description: 'clear sky' },
  MostlyClear: { id: 801, icon: '02', description: 'mostly clear' },
  PartlyCloudy: { id: 802, icon: '03', description: 'partly cloudy' },
  MostlyCloudy: { id: 803, icon: '04', description: 'mostly cloudy' },
  Cloudy: { id: 804, icon: '04', description: 'cloudy' },

  Foggy: { id: 741, icon: '50', description: 'fog' },
  Haze: { id: 721, icon: '50', description: 'haze' },
  Smoky: { id: 711, icon: '50', description: 'smoke' },
  BlowingDust: { id: 731, icon: '50', description: 'blowing dust' },

  // OpenWeather's scale has no plain "it is windy": the closest thing in the
  // group a client draws is a squall, and the extended Beaufort codes are not
  // in the icon set. Both land on squalls rather than on a clear sky, which
  // would be the one wrong answer — the sky is not the point of these two.
  Breezy: { id: 771, icon: '50', description: 'breezy' },
  Windy: { id: 771, icon: '50', description: 'windy' },

  Drizzle: { id: 301, icon: '09', description: 'drizzle' },
  Rain: { id: 501, icon: '10', description: 'rain' },
  HeavyRain: { id: 502, icon: '10', description: 'heavy rain' },
  SunShowers: { id: 500, icon: '10', description: 'sun showers' },

  IsolatedThunderstorms: {
    id: 210,
    icon: '11',
    description: 'isolated thunderstorms',
  },
  ScatteredThunderstorms: {
    id: 211,
    icon: '11',
    description: 'scattered thunderstorms',
  },
  Thunderstorms: { id: 211, icon: '11', description: 'thunderstorms' },
  StrongStorms: { id: 212, icon: '11', description: 'strong storms' },
  TropicalStorm: { id: 961, icon: '11', description: 'tropical storm' },
  Hurricane: { id: 962, icon: '11', description: 'hurricane' },

  Hail: { id: 906, icon: '13', description: 'hail' },
  Flurries: { id: 600, icon: '13', description: 'flurries' },
  SunFlurries: { id: 600, icon: '13', description: 'sun flurries' },
  Snow: { id: 601, icon: '13', description: 'snow' },
  HeavySnow: { id: 602, icon: '13', description: 'heavy snow' },
  BlowingSnow: { id: 601, icon: '13', description: 'blowing snow' },
  Blizzard: { id: 622, icon: '13', description: 'blizzard' },
  Sleet: { id: 611, icon: '13', description: 'sleet' },
  WintryMix: { id: 616, icon: '13', description: 'wintry mix' },
  FreezingDrizzle: { id: 511, icon: '13', description: 'freezing drizzle' },
  FreezingRain: { id: 511, icon: '13', description: 'freezing rain' },

  // Neither is a description of the sky, and OpenWeather files both under its
  // extended codes rather than its condition groups. Kept apart from `Clear`
  // so a client can tell "it is hot" from "there are no clouds".
  Hot: { id: 904, icon: '01', description: 'hot' },
  Frigid: { id: 903, icon: '13', description: 'frigid' },
};

/** What an unrecognised code becomes: cloudy, and honest about the words. */
const UNKNOWN: AppleCondition = { id: 804, icon: '04', description: '' };

/**
 * The three fields, from the one Apple sends.
 *
 * `daylight` decides the icon's suffix, and it comes off the reading rather
 * than off the clock: Apple already knows whether the sun is up at that
 * coordinate, and working it out here from a sunrise we may not have fetched
 * would be guessing at something already in hand.
 *
 * A code this table has never heard of keeps its own spelling as the
 * description — `MostlyClear` reads worse than "mostly clear" but is at least
 * true — and falls back to cloudy for the icon, which is the middle of the
 * scale rather than a claim of good weather.
 */
export const describe = (
  conditionCode: string | undefined,
  daylight: boolean,
): { condition: number; icon: string; description: string } => {
  const condition = (conditionCode && CONDITIONS[conditionCode]) || UNKNOWN;
  return {
    condition: condition.id,
    icon: `${condition.icon}${daylight ? 'd' : 'n'}`,
    description: condition.description || spell(conditionCode ?? ''),
  };
};

/** `IsolatedThunderstorms` as words, for a code added after this shipped. */
const spell = (conditionCode: string): string =>
  conditionCode
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
