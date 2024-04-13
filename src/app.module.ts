import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { CinemaController } from './controllers/cinema.controller';
import { CinemaService } from './services/cinema.service';
import { TheMovieDBService } from './services/themoviedb.service';
import { cacheMaxSize, cacheTTL } from './utils';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    HttpModule,
    CacheModule.register({
      ttl: cacheTTL,
      max: cacheMaxSize,
    }),
  ],
  controllers: [CinemaController],
  providers: [CinemaService, TheMovieDBService],
})
export class AppModule {}
