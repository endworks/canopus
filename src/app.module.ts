import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CinemaModule } from './modules/cinema.module';
import { cacheMaxSize, cacheTTL } from './utils';

@Module({
  imports: [
    HttpModule,
    CacheModule.register({
      ttl: cacheTTL,
      max: cacheMaxSize,
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI, {
      dbName: 'zine',
    }),
    CinemaModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
