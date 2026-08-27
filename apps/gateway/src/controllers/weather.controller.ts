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

/**
 * The same reading, for a row that is on until it is turned off.
 *
 * Only the forecast: it is the one part of the answer that was always there,
 * and a caller who has never heard of the header should keep getting it.
 */
const enabledByDefault = (value?: string): boolean =>
  value === undefined || enabled(value);

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
      "caller's own: this endpoint holds none. The UV index and the official warnings come from " +
      'other services, are opt-in behind their own headers, and are credited separately in ' +
      '`attribution`.',
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
    name: 'safety',
    enum: [
      'green',
      'yellow',
      'orange',
      'red',
      'minor',
      'moderate',
      'severe',
      'extreme',
    ],
    required: false,
    description:
      'Least band of warning worth returning, as either a MeteoAlarm colour or the CAP severity ' +
      'beside it — `orange` and `severe` are the same floor. Only meaningful with ' +
      '`X-Weather-Alerts`. Absent returns every warning in force. Warnings are ranked by their ' +
      'colour rather than their severity where the two disagree, which they do across the feed: ' +
      'Spain files yellow as Moderate and Germany files it as Minor, and the colour is the one ' +
      'MeteoAlarm normalises across its members.',
  })
  @ApiQuery({
    name: 'area',
    type: String,
    required: false,
    description:
      'Keep only warnings whose region matches this, ignoring case and accents. Matched as a ' +
      "substring of the region names in a warning's `areas`, or exactly against one of its " +
      'region codes. Only meaningful with `X-Weather-Alerts`.',
    example: 'Menorca',
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
    name: 'X-Weather-Alerts',
    required: false,
    description:
      'Set to include the official weather warnings in force, from MeteoAlarm (EUMETNET, no key ' +
      'needed) and credited separately in `attribution`. Off by default, like the UV index: it ' +
      'is another party in the request. Europe only — MeteoAlarm aggregates the European ' +
      'national met offices, and a place outside their coverage comes back with no `alerts` at ' +
      'all rather than an empty list. Narrow further with `safety` and `area`. The response says ' +
      'in `alertScope` whether it managed to narrow the warnings to the cell (`area`) or is ' +
      'handing back everything the country has (`country`).',
  })
  @ApiHeader({
    name: 'X-Weather-Forecast',
    required: false,
    description:
      'Set to `false`, `0` or `no` to skip the short forecast and the upstream call it costs. ' +
      "On by default. It also carries the day's high and low — OpenWeather's own min/max on the " +
      'current reading is the spread across reporting stations, a different quantity — so with ' +
      'the forecast off, `current.high` and `current.low` collapse to the observed temperature.',
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
    @Query('safety') safety: string,
    @Query('area') area: string,
    @Headers('X-Weather-Provider') provider: string,
    @Headers('X-Weather-Api-Key') apiKey: string,
    @Headers('X-Weather-Uv') uv: string,
    @Headers('X-Weather-Alerts') alerts: string,
    @Headers('X-Weather-Forecast') forecast: string,
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
      includeAlerts: enabled(alerts),
      safety,
      area,
      includeForecast: enabledByDefault(forecast),
    });
  }
}
