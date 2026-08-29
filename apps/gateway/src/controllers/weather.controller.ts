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
 * The forecast and the air: both were part of the answer before there was a
 * header for either, and a caller who has never heard of one should keep
 * getting what they have always had. The sun and the warnings are the other
 * way round — they arrived as headers and have always had to be asked for.
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
  @ApiQuery({
    name: 'country',
    type: String,
    required: false,
    description:
      'ISO alpha-2 country the coordinates stand in. Only needed when asking by `lat`/`lon` ' +
      'with `X-Weather-Alerts` on: the warnings are scoped by country and a coordinate does not ' +
      'carry one, so without it a coordinate-only request comes back with no warnings. Asking ' +
      'by `location` works it out from the geocoded place instead.',
    example: 'ES',
  })
  @ApiHeader({
    name: 'X-Weather-Api-Key',
    required: false,
    description:
      "The caller's own credential for the chosen provider — an API key, or for Apple a " +
      'WeatherKit developer token, which is an ES256 JWT signed with an Apple Developer key. ' +
      'Required unless the provider reports `managed: true` in `GET /weather/providers`, which ' +
      'means this deployment was configured with a credential of its own and the caller sends ' +
      'nothing. That exists because a WeatherKit key cannot be carried by an app: anything in a ' +
      'bundle can be read out of it. A key the caller does send is always preferred, so its own ' +
      "quota is spent rather than the deployment's.",
  })
  @ApiHeader({
    name: 'X-Weather-Client-Key',
    required: false,
    description:
      "Proof that you may spend this deployment's own credential. Needed only for a provider " +
      'reporting `managed: true` in `GET /weather/providers`, and only when you send no ' +
      '`X-Weather-Api-Key` of your own — that quota is finite and somebody pays for it, so an ' +
      'unrecognised caller is turned away rather than quietly billed to us. A caller sending ' +
      'their own provider key needs none of this.',
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
      'Set to include the official weather warnings in force. Off by default. Where they come ' +
      'from depends on the provider: Apple issues its own, for the coordinate asked about and ' +
      'for most of the world, in the same request as the reading. Every other provider borrows ' +
      "MeteoAlarm's (EUMETNET, no key needed), which is another party in the request and is " +
      'credited separately in `attribution` where a warning of theirs is on show — and which ' +
      'covers Europe only, so a place outside it comes back with no `alerts` at all rather ' +
      'than an empty list. An empty list is the feed answering that nothing is in force, and ' +
      'carries no credit with it: there is nothing of theirs being shown. Narrow further with ' +
      '`safety` and `area`. The response says in `alertScope` whether the warnings are narrowed ' +
      'to the place (`area`) or are everything the country has (`country`).',
  })
  @ApiHeader({
    name: 'X-Weather-Forecast',
    required: false,
    description:
      'Set to `false`, `0` or `no` to skip the short forecast and the upstream call it costs. ' +
      "On by default. With OpenWeather it also carries the day's high and low — that provider's " +
      'own min/max on the current reading is the spread across reporting stations, a different ' +
      'quantity — so with the forecast off, `current.high` and `current.low` collapse to the ' +
      'observed temperature. Apple states the range outright and answers everything in one ' +
      'request, so there the flag shapes the response without saving a call.',
  })
  @ApiHeader({
    name: 'X-Weather-Air',
    required: false,
    description:
      'Set to `false`, `0` or `no` to skip the air quality and every call it costs. On by ' +
      'default, because it was part of the answer before this header existed. Off, nobody is ' +
      "asked: not the city network, not the provider's own endpoint — OpenWeather's " +
      '`/air_pollution` is a second request against your key — and not the model behind them. ' +
      'On, the city that measures the cell is asked first and, where it answers, is the only ' +
      'one asked: a station beats any model, so no provider is billed for one that would be ' +
      'overruled. `airQuality` is absent from `current` when this is off, along with any ' +
      'source credited only for it.',
  })
  @ApiHeader({
    name: 'X-Weather-Uv',
    required: false,
    description:
      'Set to include the UV index. Off by default: for most providers it is a second party in ' +
      'the request — Open-Meteo, no key needed, credited separately in `attribution` — and a ' +
      'caller who does not want one simply does not send this. Apple carries the index itself, ' +
      'so asking Apple for it adds nobody and costs no extra call.',
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
    @Query('country') country: string,
    @Headers('X-Weather-Provider') provider: string,
    @Headers('X-Weather-Api-Key') apiKey: string,
    @Headers('X-Weather-Client-Key') clientKey: string,
    @Headers('X-Weather-Uv') uv: string,
    @Headers('X-Weather-Alerts') alerts: string,
    @Headers('X-Weather-Forecast') forecast: string,
    @Headers('X-Weather-Air') air: string,
  ) {
    return this.weatherService.getWeather({
      location,
      latitude,
      longitude,
      language,
      units,
      provider,
      apiKey,
      clientKey,
      includeUv: enabled(uv),
      includeAlerts: enabled(alerts),
      safety,
      area,
      country,
      includeForecast: enabledByDefault(forecast),
      includeAirQuality: enabledByDefault(air),
    });
  }
}
