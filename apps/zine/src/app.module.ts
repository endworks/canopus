import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { requireEnv } from '@canopus/shared';
import { LoggingModule } from '@canopus/nest';
import { CinemaModule } from './modules/cinema.module';
import { cacheTTL } from './utils';

@Module({
  imports: [
    LoggingModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) =>
        requireEnv(config, ['MONGODB_URI', 'THE_MOVIE_DB_API_KEY']),
    }),
    // Global so CinemaService and TheMovieDBService share this configured
    // instance instead of a second, default-TTL one registered per module.
    CacheModule.register({ isGlobal: true, ttl: cacheTTL }),
    MongooseModule.forRoot(process.env.MONGODB_URI, {
      dbName: 'zine',
    }),
    CinemaModule,
  ],
})
export class AppModule {}
