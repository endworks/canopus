import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CinemaController } from '../controllers/cinema.controller';
import { Cinema, CinemaSchema } from '../schemas/cinema.schema';
import { Movie, MovieSchema } from '../schemas/movie.schema';
import { CinemaService } from '../services/cinema.service';
import { ReservaEntradasService } from '../services/reserva-entradas.service';
import { TheMovieDBService } from '../services/themoviedb.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cinema.name, schema: CinemaSchema },
      { name: Movie.name, schema: MovieSchema },
    ]),
    HttpModule,
  ],
  controllers: [CinemaController],
  providers: [CinemaService, ReservaEntradasService, TheMovieDBService],
  exports: [CinemaService],
})
export class CinemaModule {}
