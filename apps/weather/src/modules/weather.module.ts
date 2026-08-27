import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { WeatherController } from '../controllers/weather.controller';
import { ClientKeys, clientKeys } from '../providers/client-keys';
import { MeteoAlarmProvider } from '../providers/meteoalarm.provider';
import { OpenMeteoAirProvider } from '../providers/open-meteo-air.provider';
import { OpenMeteoUvProvider } from '../providers/open-meteo-uv.provider';
import { RegionAtlas } from '../providers/region-atlas';
import { weatherProviders } from '../providers/registry';
import { WeatherService } from '../services/weather.service';

@Module({
  imports: [HttpModule],
  controllers: [WeatherController],
  providers: [
    ...weatherProviders,
    OpenMeteoUvProvider,
    OpenMeteoAirProvider,
    MeteoAlarmProvider,
    RegionAtlas,
    { provide: ClientKeys, useFactory: () => clientKeys() },
    WeatherService,
  ],
})
export class WeatherModule {}
