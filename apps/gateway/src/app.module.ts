import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { requireEnv, SERVICE_TOKENS, TCP_PORT } from '@canopus/shared';
import { LoggingModule } from '@canopus/nest';
import { RAEController } from './controllers/rae.controller';
import { TwitterDownloaderController } from './controllers/twitter-downloader.controller';
import { ZaragozaController } from './controllers/zaragoza.controller';
import { ZineController } from './controllers/zine.controller';
import { RAEService } from './services/rae.service';
import { TwitterDownloaderService } from './services/twitter-downloader.service';
import { ZaragozaService } from './services/zaragoza.service';
import { ZineService } from './services/zine.service';
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
    ClientsModule.register(
      Object.values(SERVICE_TOKENS).map((name) => ({
        name,
        transport: Transport.TCP,
        options: { host: process.env[`${name}_HOST`], port: TCP_PORT },
      })),
    ),
  ],
  controllers: [
    TwitterDownloaderController,
    ZaragozaController,
    ZineController,
    RAEController,
  ],
  providers: [
    TwitterDownloaderService,
    ZaragozaService,
    ZineService,
    RAEService,
  ],
})
export class AppModule {}
