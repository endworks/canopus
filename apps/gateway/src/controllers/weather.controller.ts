import {
  Controller,
  Get,
  Headers,
  ParseFloatPipe,
  Query,
} from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  WeatherProviderInfo,
  WeatherReading,
  WeatherUnits,
} from '../models/weather.interface';
import { ErrorResponse } from '../models/error.interface';
import { WeatherService } from '../services/weather.service';

/**
 * A header set to anything but a plain refusal is on.
 *
 * `X-Weather-Uv: 1` and a bare `X-Weather-Uv:` are both a caller asking for the
 * row, and turning either down on a technicality helps nobody.
 */
const enabled = (value?: string): boolean => {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== 'false' && normalized !== '0' && normalized !== 'no';
};

@ApiTags('Weather')
@ApiDefaultResponse({ description: 'Error response', type: ErrorResponse })
@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get('providers')
  @ApiOperation({ summary: 'Get the weather providers this build can use' })
  @ApiResponse({
    status: 200,
    description: 'Return the supported providers',
    type: [WeatherProviderInfo],
  })
  async weatherProviders() {
    return this.weatherService.getProviders();
  }

  @Get()
  @ApiOperation({
    summary: 'Get the weather for a place',
    description:
      'Ask by `location` or by `lat`/`lon`. Coordinates are rounded to a ~11 km cell before ' +
      'anything is fetched, and readings are cached per cell for as long as their source stands ' +
      'still — so every caller in the same town shares one upstream call. The key is the ' +
      "caller's own: this endpoint holds none.",
  })
  @ApiQuery({
    name: 'location',
    type: String,
    required: false,
    description:
      'Place name, resolved by the provider. Ignored when lat/lon are given.',
    example: 'Zaragoza',
  })
  @ApiQuery({
    name: 'lat',
    type: Number,
    required: false,
    description: 'Latitude. Must be sent together with lon.',
    example: 41.6488,
  })
  @ApiQuery({
    name: 'lon',
    type: Number,
    required: false,
    description: 'Longitude. Must be sent together with lat.',
    example: -0.8891,
  })
  @ApiQuery({
    name: 'lang',
    type: String,
    required: false,
    description: "Language for the provider's descriptions. Defaults to en.",
    example: 'es',
  })
  @ApiQuery({
    name: 'units',
    enum: ['metric', 'imperial', 'standard'],
    required: false,
    description: 'Defaults to metric.',
  })
  @ApiHeader({
    name: 'X-Weather-Api-Key',
    required: true,
    description: "The caller's own API key for the chosen provider.",
  })
  @ApiHeader({
    name: 'X-Weather-Provider',
    required: false,
    description: 'Which provider to ask. Defaults to openweather.',
  })
  @ApiHeader({
    name: 'X-Weather-Uv',
    required: false,
    description:
      'Set to include the UV index, which comes from a second provider (Open-Meteo, no key ' +
      'needed) and is credited separately in `attribution`. Off by default: it is a second ' +
      'party in the request, and a caller who does not want one simply does not send this.',
  })
  @ApiResponse({
    status: 200,
    description: 'Return the weather',
    type: WeatherReading,
  })
  async weather(
    @Query('location') location: string,
    @Query('lat', new ParseFloatPipe({ optional: true })) latitude: number,
    @Query('lon', new ParseFloatPipe({ optional: true })) longitude: number,
    @Query('lang') language: string,
    @Query('units') units: WeatherUnits,
    @Headers('x-weather-provider') provider: string,
    @Headers('x-weather-api-key') apiKey: string,
    @Headers('x-weather-uv') uv: string,
  ) {
    return this.weatherService.getWeather({
      location,
      latitude,
      longitude,
      language,
      units,
      provider,
      apiKey,
      includeUv: enabled(uv),
    });
  }
}
