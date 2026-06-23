import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { requireEnv } from '@canopus/shared';
import { LoggingModule } from '@canopus/nest';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    LoggingModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => requireEnv(config, ['TWITTER_CLIENT_TOKEN']),
    }),
    CacheModule.register({ ttl: 1000 * 60 * 60 * 6 }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
