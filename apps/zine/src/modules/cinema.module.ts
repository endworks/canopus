import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Movie, MovieSchema } from 'src/schemas/movie.schema';
import { CinemaController } from '../controllers/cinema.controller';
import { Cinema, CinemaSchema } from '../schemas/cinema.schema';
import { CinemaService } from '../services/cinema.service';
import { TheMovieDBService } from '../services/themoviedb.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cinema.name, schema: CinemaSchema },
      { name: Movie.name, schema: MovieSchema },
    ]),
    HttpModule,
    CacheModule.register(),
  ],
  controllers: [CinemaController],
  providers: [CinemaService, TheMovieDBService],
  exports: [CinemaService],
})
export class CinemaModule {}
