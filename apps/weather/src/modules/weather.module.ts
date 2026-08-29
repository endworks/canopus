import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { WeatherController } from '../controllers/weather.controller';
import { AirSources } from '../providers/air-sources';
import { ClientKeys, clientKeys } from '../providers/client-keys';
import { MeteoAlarmProvider } from '../providers/meteoalarm.provider';
import { OpenMeteoAirProvider } from '../providers/open-meteo-air.provider';
import { OpenMeteoGeocoder } from '../providers/open-meteo-geocoder';
import { OpenMeteoUvProvider } from '../providers/open-meteo-uv.provider';
import { OsmReverseGeocoder } from '../providers/osm-reverse-geocoder';
import { RegionAtlas } from '../providers/region-atlas';
import { ZaragozaAirProvider } from '../providers/zaragoza-air.provider';
import { weatherProviders } from '../providers/registry';
import { WeatherService } from '../services/weather.service';

@Module({
  imports: [HttpModule],
  controllers: [WeatherController],
  providers: [
    ...weatherProviders,
    OpenMeteoUvProvider,
    OpenMeteoGeocoder,
    OsmReverseGeocoder,
    OpenMeteoAirProvider,
    ZaragozaAirProvider,
    AirSources,
    MeteoAlarmProvider,
    RegionAtlas,
    { provide: ClientKeys, useFactory: () => clientKeys() },
    WeatherService,
  ],
})
export class WeatherModule {}
