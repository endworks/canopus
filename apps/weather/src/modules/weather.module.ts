import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { WeatherController } from '../controllers/weather.controller';
import { OpenMeteoUvProvider } from '../providers/open-meteo-uv.provider';
import { weatherProviders } from '../providers/registry';
import { WeatherService } from '../services/weather.service';

@Module({
  imports: [HttpModule],
  controllers: [WeatherController],
  providers: [...weatherProviders, OpenMeteoUvProvider, WeatherService],
})
export class WeatherModule {}
