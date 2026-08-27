import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { WEATHER_PATTERNS } from '@canopus/shared';
import { WeatherPayload } from '../models/weather.interface';
import { WeatherService } from '../services/weather.service';

@Controller()
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @MessagePattern(WEATHER_PATTERNS.weather, Transport.TCP)
  async weather(@Payload() data: WeatherPayload) {
    return this.weatherService.getWeather(data);
  }

  @MessagePattern(WEATHER_PATTERNS.providers, Transport.TCP)
  async providers() {
    return this.weatherService.listProviders();
  }
}
