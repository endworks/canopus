import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { requireEnv, SERVICE_TOKENS, TCP_PORT } from '@canopus/shared';
import { LoggingModule } from '@canopus/nest';
import { CitiesController } from './controllers/cities.controller';
import { RAEController } from './controllers/rae.controller';
import { TwitterDownloaderController } from './controllers/twitter-downloader.controller';
import { ZaragozaController } from './controllers/zaragoza.controller';
import { WeatherController } from './controllers/weather.controller';
import { ZineController } from './controllers/zine.controller';
import { PushController } from './controllers/push.controller';
import { AgendaController } from './controllers/agenda.controller';
import { AgendaAdminController } from './controllers/agenda-admin.controller';
import { SearchController } from './controllers/search.controller';
import { CitiesService } from './services/cities.service';
import { RAEService } from './services/rae.service';
import { TwitterDownloaderService } from './services/twitter-downloader.service';
import { ZaragozaService } from './services/zaragoza.service';
import { WeatherService } from './services/weather.service';
import { ZineService } from './services/zine.service';
import { PushService } from './services/push.service';
import { AgendaService } from './services/agenda.service';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    LoggingModule,
    HealthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV
        ? `.env.${process.env.NODE_ENV}`
        : '.env',
      validate: (config) =>
        requireEnv(
          config,
          Object.values(SERVICE_TOKENS).map((token) => `${token}_HOST`),
        ),
    }),
    // One TCP client per backend; host comes from `${TOKEN}_HOST`, port is shared.
    // Asked of ConfigService, not read off process.env here: @nestjs/config 12.1
    // loads the .env file after this array is built, and a client with no host
    // dials localhost:3000, which is this gateway's own HTTP server.
    ClientsModule.registerAsync(
      Object.values(SERVICE_TOKENS).map((name) => ({
        name,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP as const,
          options: {
            host: config.getOrThrow<string>(`${name}_HOST`),
            port: TCP_PORT,
          },
        }),
      })),
    ),
  ],
  controllers: [
    CitiesController,
    ZaragozaController,
    ZineController,
    WeatherController,
    RAEController,
    TwitterDownloaderController,
    PushController,
    AgendaController,
    AgendaAdminController,
    SearchController,
  ],
  providers: [
    CitiesService,
    ZaragozaService,
    ZineService,
    WeatherService,
    RAEService,
    TwitterDownloaderService,
    PushService,
    AgendaService,
  ],
})
export class AppModule {}
