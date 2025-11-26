import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusModule } from './modules/bus.module';
import { BiziModule } from './modules/bizi.module';
import { TramModule } from './modules/tram.module';

@Module({
  imports: [
    HttpModule,
    CacheModule.register(),
    MongooseModule.forRoot(process.env.MONGODB_URI, {
      dbName: 'zaragoza'
    }),
    BusModule,
    TramModule,
    BiziModule
  ],
  controllers: [],
  providers: []
})
export class AppModule {}
