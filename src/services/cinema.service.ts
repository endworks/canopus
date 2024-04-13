import { HttpService } from '@nestjs/axios';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import {
  Cinema,
  CinemaDetailsBasic,
  CinemaDetails,
  MovieBasic,
  Movie,
  Session,
  CacheData,
} from 'src/models/cinema.interface';
import { ErrorResponse } from '../models/common.interface';
import { cinemas } from 'src/data/cinemas';
import { lastValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import {
  minutesToString,
  sanitizeTitle,
  generateSlug,
  cacheMaxSize,
} from 'src/utils';
import { TheMovieDBService } from './themoviedb.service';
import {
  TheMovieDBMovie,
  TheMovieDBSearchResult,
} from 'src/models/themoviedb.interface';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

@Injectable()
export class CinemaService {
  private readonly logger = new Logger('CinemaService');

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
    private theMovieDb: TheMovieDBService,
  ) {}

  public async getCinemas(): Promise<Cinema[] | ErrorResponse> {
    const cache: Cinema[] = await this.cacheManager.get('cinema');
    if (cache) return cache;
    const resp: Cinema[] = Object.keys(cinemas).map((id) => {
      return {
        id,
        ...cinemas[id],
      };
    });
    await this.cacheManager.set('cinema', resp);
    return resp;
  }

  public async getCinemaBasic(
    id: string,
  ): Promise<CinemaDetailsBasic | ErrorResponse> {
    if (cinemas[id]) {
      const cache: CinemaDetailsBasic = await this.cacheManager.get(
        `cinema/${id}/basic`,
      );
      if (cache) return cache;
      try {
        let movies;
        switch (id) {
          case 'victoria':
          case 'maravillas':
          case 'lys':
          case 'abcpark':
          case 'abcgranturia':
          case 'abcelsaler':
          case 'abcgandia':
          case 'palafox':
          case 'aragonia':
          case 'cervantes':
            movies = await this.getMoviesReservaEntradas(id);
            break;
          case 'grancasa':
          case 'venecia':
            movies = await this.getMoviesCinesa(id);
            break;
          case 'cinemundo':
            movies = await this.getMoviesCineapolis(id);
            break;
          default:
            movies = [];
        }

        const resp = {
          id,
          ...cinemas[id],
          lastUpdated: new Date().toISOString(),
          movies: movies,
        };
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
    if (cinemas[id]) {
      const cache: CinemaDetails = await this.cacheManager.get(`cinema/${id}`);
      if (cache) return cache;
      try {
        const cinema = await this.getCinemaBasic(id);
        let movies = 'movies' in cinema ? (cinema.movies as Movie[]) : [];
        const config = await this.theMovieDb.configuration();
        movies = await Promise.all(
          movies.map(async (movie): Promise<Movie> => {
            const search = await this.theMovieDb.search(
              sanitizeTitle(movie.name),
              'es-ES',
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

        const resp = {
          ...cinema,
          movies: movies,
        };
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
      const keys = await this.cacheManager.store.keys();
      const caches = keys.sort();
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
      await this.cacheManager.reset();
      const cinemas = await this.getCinemas();
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
      const keys = await this.cacheManager.store.keys();
      const caches = keys.sort();
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

  async getMoviesReservaEntradas(id: string): Promise<MovieBasic[]> {
    const response = await lastValueFrom(
      this.httpService.get(cinemas[id].source),
    );
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
          let specialEdition = null;
          if (name.toLowerCase().includes('cine club lys')) {
            specialEdition = 'Cine Club Lys';
            name = name.replace(/CINE CLUB LYS :/, '');
          } else if (name.toLowerCase().includes('proyecto viridiana')) {
            specialEdition = 'Proyecto Viridiana';
            name = name.replace(/PROYECTO VIRIDIANA: /, '');
          } else if (name.toLowerCase().includes('club rosebud')) {
            specialEdition = 'Club Rosebud';
            name = name.replace(/ - CLUB ROSEBUD/, '');
          } else if (name.toLowerCase().includes('4K')) {
            specialEdition = '4K';
            name = name.replace(/4K/, '');
          } else if (/(\d+ aniversario)/gim.test(name)) {
            specialEdition = /(\d+ aniversario)/gim.exec(name)[0];
            name = name.replace(/\(\d+ aniversario\)/gim, '');
          }
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

  async getMoviesPalafox(id: string): Promise<MovieBasic[]> {
    const response = await lastValueFrom(
      this.httpService.get(cinemas[id].source),
    );
    const $ = cheerio.load(response.data);
    return (await Promise.all(
      $('.views-field-nothing')
        .map(async (_, value) => {
          const source = `https://www.cinespalafox.com${$(value)
            .find('a')
            .attr('href')}`;
          const filmResponse = await lastValueFrom(
            this.httpService.get(source),
          );
          const $2 = cheerio.load(filmResponse.data);
          const name = $2('h1').text();
          const id = generateSlug(name);
          const poster = $2('.imagecache-cartelDetalle').attr('src');
          const trailer = $2('#urlvideo').text();
          const synopsis = $2('.sinopsis p').first().text();
          const details = $2('.datos span');
          const genres = details.eq(0).text().split(', ');
          const duration = parseInt(
            details
              .eq(details.length - 3)
              .text()
              .replace(/[^\d]/g, ''),
          );
          const durationReadable = minutesToString(duration);
          const director = details.eq(details.length - 2).text();
          const actors = details
            .eq(details.length - 1)
            .text()
            .split(', ');
          const sessions = [];
          const parsedDate = $2('.horarios ul li').eq(0).text();
          const splitDate = parsedDate.split('/');
          const date = `${splitDate[2]}-${splitDate[1]}-${splitDate[0]}`;
          const schedules = $2('.horarios ul li').eq(1).find('a');
          schedules.each((index) => {
            const inputMatch = /Sala (\d+) - (\d+:\d+)(?: \((\w.+)\))?/.exec(
              schedules.eq(index).text(),
            );
            const session: Session = {
              date,
              time: inputMatch[2],
              room: inputMatch[1],
              type: inputMatch[3],
              url: schedules.eq(index).attr('href'),
            };
            sessions.push(session);
          });
          const movie: MovieBasic = {
            id,
            name,
            synopsis,
            duration,
            durationReadable,
            sessions,
            director: {
              name: director,
            },
            actors: actors.map((actor) => {
              return {
                name: actor,
              };
            }),
            genres,
            poster,
            trailer,
            source,
          };
          return movie;
        })
        .toArray(),
    )) as any;
  }

  async getMoviesCinesa(id: string): Promise<MovieBasic[]> {
    const cinema = id === 'venecia' ? 'puerto-venecia' : id;
    const response = await lastValueFrom(
      this.httpService.get(cinemas[id].source),
    );
    return response.data.cartelera[0].peliculas.map((item): MovieBasic => {
      const sessions: Session[] = [];
      item.cines.forEach((cine) => {
        cine.tipos.forEach((tipo) => {
          tipo.salas.forEach((sala) => {
            sala.sesiones.forEach((sesion) => {
              sessions.push({
                date: response.data.cartelera[0].dia,
                time: sesion.hora,
                room: sala.salanum,
                type: sala.sala !== sala.salanum ? sala.sala : null,
                url: sesion.ao,
              });
            });
          });
        });
      });

      return {
        id: item.url,
        name: item.titulo,
        duration: item.duracion,
        durationReadable: minutesToString(item.duracion),
        sessions,
        director: {
          name: item.directores,
        },
        actors: (item.actores || '').split(', ').map((actor) => {
          return {
            name: actor,
          };
        }),
        genres: (item.genero || '').split(' - '),
        poster: item.cartel,
        source: `https://www.cinesa.es/Peliculas/${item.url}/${cinema}`,
      };
    });
  }

  async getMoviesCineapolis(id: string): Promise<MovieBasic[]> {
    const response = await lastValueFrom(
      this.httpService.get(cinemas[id].source),
    );
    const $ = cheerio.load(response.data);
    return (await Promise.all(
      $('.portfolio-item')
        .map(async (_, value) => {
          const source = `https://cineapolis.es/${$(value)
            .find('a')
            .attr('href')}`;
          const filmResponse = await lastValueFrom(
            this.httpService.get(source),
          );
          const $2 = cheerio.load(filmResponse.data);
          const name = $2('.h3 [itemprop=name]').text();
          const id = generateSlug(name);
          const poster = $2('.card-img-top').attr('src');
          const trailer = $2('.embed-responsive-item').attr('src');
          const synopsis = $2('[itemprop=description]').text();
          const genres = $2('[itemprop=genre]').text().split(', ');
          const duration = parseInt(
            $2('[itemprop=duration]').text().split(' ')[0],
          );
          const durationReadable = minutesToString(duration);
          const director = $2('[itemprop=director]').text();
          const actors = $2('[itemprop=actor]').text().split(', ');
          const sessions = [];
          const tickets = $2(
            '.row [itemtype=http://schema.org/doorTime]',
          ).first();
          const parsedDate = tickets
            .find('[itemprop=DateTime]')
            .first()
            .text()
            .replace(/\s/gm, '');
          const type = tickets
            .find('[itemprop=videoformat]')
            .first()
            .text()
            .replace(/\s/gm, '');
          const splitDate = parsedDate.split('/');
          const date = `${splitDate[2]}-${splitDate[1]}-${splitDate[0]}`;
          const schedules = tickets.find('[itemprop=DateTime] a');
          schedules.each((index) => {
            const session: Session = {
              date,
              time: schedules.eq(index).text().trim(),
              type,
              url: `https://cineapolis.es${schedules.eq(index).attr('href')}`,
            };
            sessions.push(session);
          });
          const movie: MovieBasic = {
            id,
            name,
            synopsis,
            duration,
            durationReadable,
            sessions,
            director: {
              name: director,
            },
            actors: actors.map((actor) => {
              return {
                name: actor.replace(/\s/gm, ''),
              };
            }),
            genres,
            poster,
            trailer,
            source,
          };
          return movie;
        })
        .toArray(),
    )) as any;
  }
}
