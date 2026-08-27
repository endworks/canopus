import { Provider } from '@nestjs/common';
import { AppleWeatherProvider } from './apple-weather.provider';
import { OpenWeatherProvider } from './open-weather.provider';
import { WeatherProvider } from './weather-provider';

/** DI token for the provider registry, keyed by the id the header names. */
export const WEATHER_PROVIDERS = 'WEATHER_PROVIDERS';

/**
 * Every provider this build can answer from.
 *
 * The one list a second provider has to be added to: the registry keys itself
 * by `info.id`, so nothing else — not the controller, not the service, not the
 * gateway — carries a provider's name.
 */
const IMPLEMENTATIONS = [OpenWeatherProvider, AppleWeatherProvider];

export const weatherProviders: Provider[] = [
  ...IMPLEMENTATIONS,
  {
    provide: WEATHER_PROVIDERS,
    inject: IMPLEMENTATIONS,
    useFactory: (...providers: WeatherProvider[]) =>
      new Map(providers.map((provider) => [provider.info.id, provider])),
  },
];
