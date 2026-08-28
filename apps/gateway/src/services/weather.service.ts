import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { SERVICE_TOKENS, WEATHER_PATTERNS } from '@canopus/shared';
import { WeatherUnits } from '../models/weather.interface';

export interface WeatherQuery {
  location?: string;
  latitude?: number;
  longitude?: number;
  language?: string;
  units?: WeatherUnits;
  provider?: string;
  apiKey?: string;
  clientKey?: string;
  includeUv?: boolean;
  includeAlerts?: boolean;
  includeForecast?: boolean;
  includeAirQuality?: boolean;
  safety?: string;
  area?: string;
  country?: string;
}

@Injectable()
export class WeatherService {
  @Inject(SERVICE_TOKENS.weather) private client: ClientProxy;

  getWeather(query: WeatherQuery) {
    return lastValueFrom(this.client.send(WEATHER_PATTERNS.weather, query));
  }

  getProviders() {
    return lastValueFrom(this.client.send(WEATHER_PATTERNS.providers, {}));
  }
}
