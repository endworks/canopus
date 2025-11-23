import { HttpService } from '@nestjs/axios';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as cheerio from 'cheerio';
import { Model } from 'mongoose';
import { lastValueFrom } from 'rxjs';
import {
  CacheData,
  Cinema,
  CinemaDetails,
  CinemaDetailsBasic,
  Movie,
  MovieBasic,
  Session,
} from '../models/cinema.interface';
import { ErrorResponse } from '../models/common.interface';
import {
  TheMovieDBMovie,
  TheMovieDBSearchResult,
} from '../models/themoviedb.interface';
import { Cinema as CinemaSchema } from '../schemas/cinema.schema';
import { Movie as MovieSchema } from '../schemas/movie.schema';
import {
  cacheMaxSize,
  generateSlug,
  minutesToString,
  sanitizeTitle,
} from '../utils';
import { TheMovieDBService } from './themoviedb.service';

@Injectable()
export class CinemaService {
  private readonly logger = new Logger('CinemaService');

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectModel(CinemaSchema.name) private cinemaModel: Model<CinemaSchema>,
    @InjectModel(MovieSchema.name) private movieModel: Model<MovieSchema>,
    private httpService: HttpService,
    private theMovieDb: TheMovieDBService,
  ) {}

  public async getCinemas(
    location?: string,
  ): Promise<Cinema[] | ErrorResponse> {
    const cache: Cinema[] = await this.cacheManager.get(
      location ? `cinema/${location}` : 'cinema',
    );
    if (cache) return cache;
    const cinemas = await this.getAllCinemas();
    const locations = location
      ? location.includes(',')
        ? location.split(',').map((item) => item.toLowerCase())
        : [location.toLowerCase()]
      : undefined;
    const resp: Cinema[] = cinemas.filter((cinema) =>
      locations ? locations.includes(cinema.location.toLowerCase()) : true,
    );
    await this.cacheManager.set(
      location ? `cinema/${location}` : 'cinema',
      resp,
    );
    return resp;
  }

  public async getCinemaBasic(
    id: string,
  ): Promise<CinemaDetailsBasic | ErrorResponse> {
    const cinema = await this.getCinemaById(id);
    if (cinema) {
      const cache: CinemaDetailsBasic = await this.cacheManager.get(
        `cinema/${id}/basic`,
      );
      if (cache) return cache;
      try {
        const movies = await this.getMoviesReservaEntradas(id);
        const movieIds = movies.map((movie) => movie.id);
        const sessions = {};
        movies.forEach((movie) => {
          sessions[movie.id] = movie.sessions;
        });

        const { _id, ...cinemaDetails } = cinema;

        const resp = {
          id,
          ...cinemaDetails,
          lastUpdated: new Date().toISOString(),
          movies,
        };

        await this.saveCinema({ ...resp, movies: movieIds, sessions });
        await this.cacheManager.set(`cinema/${id}/basic`, resp);
        return resp;
      } catch (exception) {
        throw new InternalServerErrorException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: exception.message,
          },
          exception.message,
        );
      }
    } else {
      throw new NotFoundException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `Resource with ID '${id}' was not found`,
        },
        `Resource with ID '${id}' was not found`,
      );
    }
  }

  public async getCinema(id: string): Promise<CinemaDetails | ErrorResponse> {
    const cinema = await this.getCinemaBasic(id);
    if (cinema) {
      const cache: CinemaDetails = await this.cacheManager.get(`cinema/${id}`);
      if (cache) return cache;
      try {
        let movies = 'movies' in cinema ? (cinema.movies as Movie[]) : [];
        const config = await this.theMovieDb.configuration();
        movies = await Promise.all(
          movies.map(async (movie): Promise<Movie> => {
            const search = await this.theMovieDb.search(
              sanitizeTitle(movie.name),
              'es-ES',
              new Date().getFullYear(),
            );
            if (!search.results || search.results.length === 0) {
              this.logger.error(
                `'${sanitizeTitle(movie.name)}' not found on TheMovieDatabase`,
              );
              return movie;
            }

            let matches: TheMovieDBSearchResult[] = search.results.filter(
              (result) =>
                sanitizeTitle(movie.name) === sanitizeTitle(result.title),
            );

            if (matches.length === 0) {
              matches = search.results.filter((result) =>
                sanitizeTitle(movie.name).includes(sanitizeTitle(result.title)),
              );
            }

            if (matches.length === 0) {
              matches = search.results.filter((result) =>
                sanitizeTitle(result.title).includes(sanitizeTitle(movie.name)),
              );
            }

            if (search.results.length === 1) {
              matches = search.results;
            }

            let movieDB: TheMovieDBMovie;

            if (matches.length === 1) {
              movieDB = await this.theMovieDb.movie(matches[0].id, 'es-ES');
            } else if (matches.length === 0) {
              this.logger.error(`'${movie.name}' got no results`);
              return movie;
            } else {
              await Promise.all(
                matches.map(async (match) => {
                  await this.theMovieDb
                    .movie(match.id, 'es-ES')
                    .then((result) => {
                      if (
                        result.runtime > 0 &&
                        movie.duration + 20 > result.runtime &&
                        movie.duration - 20 < result.runtime
                      ) {
                        this.logger.log(
                          `Should match '${movie.name}' duration: ${movie.duration} ≈ ${result.runtime}`,
                        );
                        movieDB = result;
                      }
                    });
                }),
              );
            }

            if (!movieDB) {
              this.logger.error(`'${movie.name}' not matched with any result`);
              return movie;
            }

            // Check the duration to be sure that is the same movie
            if (
              movieDB.runtime > 0 &&
              (movie.duration + 20 < movieDB.runtime ||
                movie.duration - 20 > movieDB.runtime)
            ) {
              this.logger.error(
                `'${movie.name}' and '${movieDB.title}' duration doesn't match: ${movie.duration} != ${movieDB.runtime}`,
              );
              return movie;
            }

            const movieDBCredits = await this.theMovieDb.movieCredits(
              movieDB.id,
              'es-ES',
            );

            const movieDBVideos = await this.theMovieDb.movieVideos(
              movieDB.id,
              'es-ES',
            );

            const trailer = movieDBVideos.results.map(
              (video) => `http://www.youtube.com/watch?v=${video.key}`,
            )[0];

            const director = movieDBCredits.crew
              .map((crew) => {
                if (crew.job === 'Director')
                  return {
                    name: crew.name,
                    picture: crew.profile_path
                      ? `${config.images.secure_base_url}w185${crew.profile_path}`
                      : null,
                  };
              })
              .filter((item) => item)[0];

            const writers = movieDBCredits.crew
              .map((crew) => {
                if (crew.job === 'Screenplay' || crew.job === 'Writer')
                  return {
                    name: crew.name,
                    picture: crew.profile_path
                      ? `${config.images.secure_base_url}w185${crew.profile_path}`
                      : null,
                  };
              })
              .filter((item) => item);

            const actors = movieDBCredits.cast
              .map((cast) => {
                if (cast.known_for_department === 'Acting')
                  return {
                    name: cast.name,
                    character: cast.character,
                    picture: cast.profile_path
                      ? `${config.images.secure_base_url}w185${cast.profile_path}`
                      : null,
                  };
              })
              .filter((item) => item);

            return {
              ...movie,
              theMovieDbId: movieDB.id,
              imDbId: movieDB.imdb_id,
              name: movieDB.title,
              originalName: movieDB.original_title,
              duration: movieDB.runtime || movie.duration,
              durationReadable: minutesToString(
                movieDB.runtime || movie.duration,
              ),
              tagline: movieDB.tagline,
              poster: movieDB.poster_path
                ? `${config.images.secure_base_url}w342${movieDB.poster_path}`
                : movie.poster,
              synopsis: movieDB.overview,
              trailer: trailer || movie.trailer || null,
              director: director || null,
              writers: writers.length > 0 ? writers : null,
              actors: actors.length > 0 ? actors : null,
              genres: movieDB.genres.map((genre) => genre.name),
              budget: movieDB.budget,
              revenue: movieDB.revenue,
              year: parseInt(movieDB.release_date.slice(0, 4)),
              releaseDate: movieDB.release_date,
              originalLanguage: movieDB.original_language,
              popularity: movieDB.popularity,
              voteAverage: movieDB.vote_average,
              voteCount: movieDB.vote_count,
            };
          }),
        );

        const movieIds = movies.map((movie) => movie.id);
        const sessions = {};
        movies.forEach((movie) => {
          sessions[movie.id] = movie.sessions;
        });

        const resp = {
          ...cinema,
          movies,
        };
        for (const movie of movies) {
          await this.saveMovie(movie);
        }
        this.saveCinema({ ...resp, movies: movieIds, sessions });
        await this.cacheManager.set(`cinema/${id}`, resp);
        return resp;
      } catch (exception) {
        throw new InternalServerErrorException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: exception.message,
          },
          exception.message,
        );
      }
    } else {
      throw new NotFoundException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: `Resource with ID '${id}' was not found`,
        },
        `Resource with ID '${id}' was not found`,
      );
    }
  }

  async cached(): Promise<CacheData | ErrorResponse> {
    try {
      const allKeys = await Promise.all(
        this.cacheManager.stores.map(async (store: any) => {
          if (store?.keys) {
            try {
              return await store.keys('*');
            } catch (err) {
              console.error('Error in store.keys():', err);
              return [];
            }
          }
          return [];
        }),
      );
      const caches = allKeys.flat().sort();
      return {
        cacheSize: `${caches.length}/${cacheMaxSize}`,
        caches,
      };
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
        },
        exception.message,
      );
    }
  }

  async updateAll(): Promise<CacheData | ErrorResponse> {
    try {
      await this.cacheManager.clear();
      await this.getCinemasReservaEntradas();
      const cinemas = await this.getCinemas('zaragoza');
      if ('statusCode' in cinemas) return;
      await Promise.all(
        cinemas.map(async (cinema) => {
          await this.getCinema(cinema.id).catch((exceptionCinema) => {
            this.logger.error(
              `failed to get movies from '${cinema.id}' with exception: '${exceptionCinema.message}'`,
            );
          });
        }),
      );
      const allKeys = await Promise.all(
        this.cacheManager.stores.map(async (store: any) => {
          if (store?.keys) {
            try {
              return await store.keys('*');
            } catch (err) {
              console.error('Error in store.keys():', err);
              return [];
            }
          }
          return [];
        }),
      );
      const caches = allKeys.flat().sort();
      return {
        cacheSize: `${caches.length}/${cacheMaxSize}`,
        caches,
      };
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
        },
        exception.message,
      );
    }
  }

  async getCinemasReservaEntradas(): Promise<Cinema[]> {
    const cache: Cinema[] = await this.cacheManager.get(
      'cinema/reservaEntradas',
    );
    if (cache) return cache;
    const url = 'https://www.reservaentradas.com/cines';
    const { data: html } = await lastValueFrom(this.httpService.get(url));
    const $ = cheerio.load(html);

    const result: Cinema[] = [];

    $('li.provincia').each((_, el) => {
      const city = $(el).clone().children().remove().end().text().trim();
      const cinemas: Cinema[] = [];
      $(el)
        .find('ul.list-cinemas li a')
        .each((_, a) => {
          let name = $(a).text().trim();
          if (!name.includes('Cine Y')) {
            name = name.replace(/^\s*Cines?\s+/i, '');
          }
          name = name.replace(/\s+/g, ' ').trim();
          const source = $(a).attr('href') || '';
          const id = source.split('/')[5].replace(/^cines?/i, '') || '';
          const location =
            source.split('/')[4] ||
            city.toLocaleLowerCase().replace(/\s+/g, '-');

          const cinema = {
            id,
            name,
            location,
            city,
            source,
          };
          cinemas.push(cinema);
        });

      result.push(...cinemas);
    });
    await Promise.all(
      result.map(async (cinema) => {
        await this.saveCinema(cinema);
      }),
    );
    await this.cacheManager.set('cinema/reservaEntradas', result);
    return result;
  }

  async getMoviesReservaEntradas(id: string): Promise<MovieBasic[]> {
    const cinema = await this.getCinemaById(id);
    const response = await lastValueFrom(this.httpService.get(cinema.source));
    const $ = cheerio.load(response.data);
    return (await Promise.all(
      $('.movie.row')
        .map(async (_, value) => {
          const source = $(value).find('a').attr('href');
          const filmResponse = await lastValueFrom(
            this.httpService.get(source),
          );
          const $2 = cheerio.load(filmResponse.data);
          let name = $2('h2 strong').first().text();
          const nameLower = name.toLowerCase();
          let specialEdition = null;
          if (nameLower.includes('cine club lys')) {
            specialEdition = 'Cine Club Lys';
            name = name.replace(/CINE CLUB LYS :/, '');
          } else if (nameLower.includes('proyecto viridiana')) {
            specialEdition = 'Proyecto Viridiana';
            name = name.replace(/PROYECTO VIRIDIANA: /, '');
          } else if (nameLower.includes('club rosebud')) {
            specialEdition = 'Club Rosebud';
            name = name.replace(/ - CLUB ROSEBUD/, '');
          } else if (nameLower.includes('4k')) {
            specialEdition = '4K';
            name = name.replace(/4K/, '');
          } else if (/(\d+ aniversario)/gim.test(name)) {
            specialEdition = /(\d+ aniversario)/gim.exec(name)[0];
            name = name.replace(/\(\d+ aniversario\)/gim, '');
          }
          name = name.replace(/\(\s*\d{4}\s*\)/g, '');
          const id = generateSlug(name);
          const sessions = [];
          const poster = $2('.media-object').attr('src').split('?')[0];
          const trailer = $2('#trailer iframe').attr('src');
          const synopsis = $2('#sinopsis_info span')
            .text()
            .replace(/\n/, '')
            .trim();
          const duration = parseInt(
            $2('.member-descriptionX > p > strong').text().split(' ')[0],
          );
          const durationReadable = minutesToString(duration);
          const tickets = $2('#1.tab-pane > div');
          const type = tickets
            .find('p')
            .first()
            .text()
            .replace(/[\s()]/gm, '');
          const schedules = tickets.find('.sessions-list a');
          schedules.each((index) => {
            const session: Session = {
              time: schedules.eq(index).text().trim(),
              type,
              url: schedules.eq(index).attr('href'),
            };
            sessions.push(session);
          });
          const movie: MovieBasic = {
            id,
            name,
            specialEdition,
            synopsis,
            duration,
            durationReadable,
            sessions,
            poster,
            trailer,
            source,
          };
          return movie;
        })
        .toArray(),
    )) as any;
  }

  async getAllCinemas() {
    return this.cinemaModel.find().sort({ id: 1 }).lean().exec();
  }

  async getAllMovies() {
    return this.movieModel.find().sort({ id: 1 }).lean().exec();
  }

  async getCinemaById(id: string) {
    return this.cinemaModel.findOne({ id }).lean();
  }

  async getMovieById(id: string) {
    return this.movieModel.findOne({ id }).lean();
  }

  async saveCinema(data: Partial<CinemaSchema>) {
    return this.cinemaModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { new: true, upsert: true },
      )
      .lean();
  }

  async saveMovie(data: Partial<MovieSchema>) {
    return this.movieModel
      .findOneAndUpdate(
        { id: data.id },
        { $set: data },
        { new: true, upsert: true },
      )
      .lean();
  }
}
