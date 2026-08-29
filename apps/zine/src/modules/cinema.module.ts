import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CinemaController } from '../controllers/cinema.controller';
import { Cinema, CinemaSchema } from '../schemas/cinema.schema';
import { Movie, MovieSchema } from '../schemas/movie.schema';
import { CinemaService } from '../services/cinema.service';
import { CinemaSources } from '../services/cinema-source';
import { GeocoderService } from '../services/geocoder.service';
import { ReservaEntradasService } from '../services/reserva-entradas.service';
import { SensaCineService } from '../services/sensacine.service';
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
  providers: [
    CinemaService,
    CinemaSources,
    GeocoderService,
    ReservaEntradasService,
    SensaCineService,
    TheMovieDBService,
  ],
  exports: [CinemaService],
})
export class CinemaModule {}
