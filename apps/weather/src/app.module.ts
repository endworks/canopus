import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { LoggingModule } from '@canopus/nest';
import { WeatherModule } from './modules/weather.module';
import { TTL } from './utils';

@Module({
  imports: [
    LoggingModule,
    // Global so every provider shares this instance rather than registering a
    // second, default-TTL one per module. The TTL here is only the fallback:
    // each upstream call passes its own, matched to how often its source moves.
    CacheModule.register({ isGlobal: true, ttl: TTL.current }),
    WeatherModule,
  ],
})
export class AppModule {}
