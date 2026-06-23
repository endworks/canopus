import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { requireEnv } from '@canopus/shared';
import { LoggingModule } from '@canopus/nest';
import { BusModule } from './modules/bus.module';
import { BiziModule } from './modules/bizi.module';
import { TramModule } from './modules/tram.module';

@Module({
  imports: [
    LoggingModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => requireEnv(config, ['MONGODB_URI']),
    }),
    HttpModule,
    CacheModule.register(),
    MongooseModule.forRoot(process.env.MONGODB_URI, {
      dbName: 'zaragoza',
    }),
    BusModule,
    TramModule,
    BiziModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
