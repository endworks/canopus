import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model } from 'mongoose';
import { cinemas as cinemaSeed } from '../data/cinemas';
import {
  CacheData,
  Cinema,
  CinemaDetails,
  CinemaDetailsBasic,
  Crew,
  Movie,
  Session,
} from '../models/cinema.interface';
import {
  TheMovieDBConfiguration,
  TheMovieDBCredits,
  TheMovieDBMovie,
  TheMovieDBSearchResult,
} from '../models/themoviedb.interface';
import { Cinema as CinemaSchema } from '../schemas/cinema.schema';
import { Movie as MovieSchema } from '../schemas/movie.schema';
import { minutesToString, sanitizeTitle } from '../utils';
import { ReservaEntradasService } from './reserva-entradas.service';
import { TheMovieDBService } from './themoviedb.service';

const LANG = 'es-ES';

/** TheMovieDB runtimes wobble against cinema listings; accept within ±20 min. */
const DURATION_TOLERANCE_MIN = 20;

/** Detail lookups are one HTTP call each, so cap the ambiguous-match probe. */
const MAX_CANDIDATE_LOOKUPS = 5;

const durationMatches = (duration: number, runtime: number): boolean =>
  runtime > 0 && Math.abs(duration - runtime) <= DURATION_TOLERANCE_MIN;

/** Mongo bookkeeping fields never belong in an RPC response. */
const stripMongoFields = <T>({ _id, __v, ...rest }: T & Record<string, any>) =>
  rest;

/**
 * Pick the best TheMovieDB results for a scraped title: exact match, then the
 * scraped title containing a result, then a result containing the scraped
 * title. A single search result is taken as-is.
 */
const selectCandidates = (
  title: string,
  results: TheMovieDBSearchResult[],
): TheMovieDBSearchResult[] => {
  if (results.length === 1) return results;
  const sanitized = results.map((result) => ({
    result,
    title: sanitizeTitle(result.title),
  }));
  const tiers = [
    (candidate: string) => candidate === title,
    (candidate: string) => title.includes(candidate),
    (candidate: string) => candidate.includes(title),
  ];
  for (const tier of tiers) {
    const matches = sanitized
      .filter((entry) => tier(entry.title))
      .map((entry) => entry.result);
    if (matches.length > 0) return matches;
  }
  return [];
};

@Injectable()
export class CinemaService {
  private readonly logger = new Logger(CinemaService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectModel(CinemaSchema.name) private cinemaModel: Model<CinemaSchema>,
    @InjectModel(MovieSchema.name) private movieModel: Model<MovieSchema>,
    private scraper: ReservaEntradasService,
    private theMovieDb: TheMovieDBService,
  ) {}

  public getCinemas(location?: string): Promise<Cinema[]> {
    const key = location ? `cinema/${location}` : 'cinema';
    return this.cacheManager.wrap(key, async () => {
      const locations = location?.toLowerCase().split(',');
      const cinemas = await this.cinemaModel.find().sort({ id: 1 }).lean();
      return cinemas
        .filter(
          (cinema) =>
            !locations || locations.includes(cinema.location?.toLowerCase()),
        )
        .map(stripMongoFields) as Cinema[];
    });
  }

  /** Showtimes only: one scrape of reservaentradas, no TheMovieDB enrichment. */
  public async getCinemaBasic(id: string): Promise<CinemaDetailsBasic> {
    const cached: CinemaDetailsBasic = await this.cacheManager.get(
      `cinema/${id}/basic`,
    );
    if (cached) return cached;

    const cinema = await this.cinemaModel.findOne({ id }).lean();
    if (!cinema) {
      throw new NotFoundException(`Resource with ID '${id}' was not found`);
    }

    const movies = await this.scraper.getMovies(cinema.source);
    const sessions = Object.fromEntries(
      movies.map((movie) => [movie.id, movie.sessions ?? []]),
    );
    const resp: CinemaDetailsBasic = {
      ...(stripMongoFields(cinema) as Cinema),
      id,
      lastUpdated: new Date().toISOString(),
      movies,
      sessions,
    };

    await this.saveCinema({
      ...resp,
      movies: movies.map((movie) => movie.id),
    });
    await this.cacheManager.set(`cinema/${id}/basic`, resp);
    return resp;
  }

  /** Showtimes plus TheMovieDB metadata for every film on the billboard. */
  public async getCinema(id: string): Promise<CinemaDetails> {
    const cached: CinemaDetails = await this.cacheManager.get(`cinema/${id}`);
    if (cached) return cached;

    const cinema = await this.getCinemaBasic(id);
    const scraped = cinema.movies as Movie[];

    let movies: Movie[];
    try {
      const config = await this.theMovieDb.configuration();
      movies = await Promise.all(
        scraped.map((movie) => this.enrichMovie(movie, config)),
      );
    } catch (exception) {
      // Enrichment is best-effort: fall back to the scraped billboard rather
      // than failing a request that already has showtimes to return.
      this.logger.error(
        `TheMovieDB enrichment failed for cinema '${id}', returning basic data: ${exception.message}`,
      );
      return this.toCinemaDetails(cinema, scraped);
    }

    const resp = this.toCinemaDetails(cinema, movies);
    await this.saveMovies(resp.movies);
    await this.saveCinema({
      ...resp,
      movies: resp.movies.map((movie) => movie.id),
    });
    await this.cacheManager.set(`cinema/${id}`, resp);
    return resp;
  }

  public getMovies(): Promise<Movie[]> {
    return this.cacheManager.wrap('movies', async () => {
      const movies = await this.movieModel.find().sort({ id: 1 }).lean();
      return movies.map(stripMongoFields) as Movie[];
    });
  }

  public async cached(): Promise<CacheData> {
    const caches = await this.listCacheKeys();
    return { cacheSize: `${caches.length}`, caches };
  }

  /** Warms every Zaragoza cinema from scratch. */
  public async updateAll(): Promise<CacheData> {
    await this.cacheManager.clear();
    await this.saveCinemas(await this.scraper.getCinemas());
    const cinemas = await this.getCinemas('zaragoza');
    await Promise.all(
      cinemas.map((cinema) =>
        this.getCinema(cinema.id).catch((exception) => {
          this.logger.error(
            `failed to get movies from '${cinema.id}' with exception: '${exception.message}'`,
          );
        }),
      ),
    );
    return this.cached();
  }

  private toCinemaDetails(
    cinema: CinemaDetailsBasic,
    movies: Movie[],
  ): CinemaDetails {
    return {
      ...cinema,
      movies: movies.map((movie) =>
        this.normalizeMovie(movie, cinema.sessions),
      ),
    };
  }

  // Movies that didn't match TheMovieDB fall through unenriched (basic shape).
  // Normalize every movie so consumers always get the array fields and never
  // crash on undefined. Sessions fall back to the cinema-level map (keyed by
  // movie id) so showtimes survive even if the movie lost its inline copy.
  private normalizeMovie(
    movie: Movie,
    sessionsMap?: Record<string, Session[]>,
  ): Movie {
    return {
      ...movie,
      sessions: movie.sessions ?? sessionsMap?.[movie.id] ?? [],
      genres: movie.genres ?? [],
      writers: movie.writers ?? [],
      actors: movie.actors ?? [],
    };
  }

  /** Overlay a scraped movie with TheMovieDB metadata, or return it unchanged. */
  private async enrichMovie(
    movie: Movie,
    config: TheMovieDBConfiguration,
  ): Promise<Movie> {
    const title = sanitizeTitle(movie.name);
    const search = await this.theMovieDb.search(
      title,
      LANG,
      new Date().getFullYear(),
    );
    if (!search.results?.length) {
      this.logger.error(`'${title}' not found on TheMovieDatabase`);
      return movie;
    }

    const candidates = selectCandidates(title, search.results);
    if (candidates.length === 0) {
      this.logger.error(`'${movie.name}' got no results`);
      return movie;
    }

    const movieDB = await this.resolveCandidate(movie, candidates);
    if (!movieDB) {
      this.logger.error(`'${movie.name}' not matched with any result`);
      return movie;
    }

    if (
      movieDB.runtime > 0 &&
      !durationMatches(movie.duration, movieDB.runtime)
    ) {
      this.logger.error(
        `'${movie.name}' and '${movieDB.title}' duration doesn't match: ${movie.duration} != ${movieDB.runtime}`,
      );
      return movie;
    }

    // Credits and videos are independent — one round trip instead of two.
    const [credits, videos] = await Promise.all([
      this.theMovieDb.movieCredits(movieDB.id, LANG),
      this.theMovieDb.movieVideos(movieDB.id, LANG),
    ]);
    const duration = movieDB.runtime || movie.duration;
    const { director, writers, actors } = this.parseCredits(credits, config);

    return {
      ...movie,
      theMovieDbId: movieDB.id,
      imDbId: movieDB.imdb_id,
      name: movieDB.title,
      originalName: movieDB.original_title,
      duration,
      durationReadable: minutesToString(duration),
      tagline: movieDB.tagline,
      poster: movieDB.poster_path
        ? `${config.images.secure_base_url}w342${movieDB.poster_path}`
        : movie.poster,
      synopsis: movieDB.overview,
      trailer: videos.results[0]
        ? `http://www.youtube.com/watch?v=${videos.results[0].key}`
        : movie.trailer || null,
      director: director || null,
      writers,
      actors,
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
  }

  /**
   * Disambiguate several title matches by runtime. Candidates are probed in
   * TheMovieDB's own popularity order and the first runtime match wins, so the
   * result doesn't depend on which request resolves first.
   */
  private async resolveCandidate(
    movie: Movie,
    candidates: TheMovieDBSearchResult[],
  ): Promise<TheMovieDBMovie | null> {
    if (candidates.length === 1) {
      return this.theMovieDb.movie(candidates[0].id, LANG);
    }
    const details = await Promise.all(
      candidates
        .slice(0, MAX_CANDIDATE_LOOKUPS)
        .map((candidate) => this.theMovieDb.movie(candidate.id, LANG)),
    );
    const match = details.find((detail) =>
      durationMatches(movie.duration, detail.runtime),
    );
    if (match) {
      this.logger.log(
        `Should match '${movie.name}' duration: ${movie.duration} ≈ ${match.runtime}`,
      );
    }
    return match ?? null;
  }

  private parseCredits(
    credits: TheMovieDBCredits,
    config: TheMovieDBConfiguration,
  ) {
    const picture = (path?: string) =>
      path ? `${config.images.secure_base_url}w185${path}` : null;
    const toCrew = (person: { name: string; profile_path?: string }): Crew => ({
      name: person.name,
      picture: picture(person.profile_path),
    });

    return {
      director: credits.crew
        .filter((crew) => crew.job === 'Director')
        .map(toCrew)[0],
      writers: credits.crew
        .filter((crew) => crew.job === 'Screenplay' || crew.job === 'Writer')
        .map(toCrew),
      actors: credits.cast
        .filter((cast) => cast.known_for_department === 'Acting')
        .map((cast) => ({ ...toCrew(cast), character: cast.character })),
    };
  }

  private async listCacheKeys(): Promise<string[]> {
    const keys = await Promise.all(
      this.cacheManager.stores.map(async (store: any) => {
        if (!store?.keys) return [];
        try {
          return await store.keys('*');
        } catch (exception) {
          this.logger.error(`failed to list cache keys: ${exception.message}`);
          return [];
        }
      }),
    );
    return keys.flat().sort();
  }

  private saveCinema(data: Partial<CinemaSchema>) {
    return this.cinemaModel.updateOne(
      { id: data.id },
      { $set: data },
      { upsert: true },
    );
  }

  /**
   * The scraper returns every cinema in the country; `cinemas.ts` supplies the
   * address/website the listings don't carry. One round trip, not one per row.
   */
  private saveCinemas(cinemas: Cinema[]) {
    const operations = cinemas.map((cinema) => {
      const { address, website } = cinemaSeed[cinema.id] ?? {};
      return {
        updateOne: {
          filter: { id: cinema.id },
          update: { $set: { ...cinema, address, website } },
          upsert: true,
        },
      };
    }) as AnyBulkWriteOperation<CinemaSchema>[];
    return operations.length ? this.cinemaModel.bulkWrite(operations) : null;
  }

  private saveMovies(movies: Movie[]) {
    const operations = movies.map((movie) => ({
      updateOne: {
        filter: { id: movie.id },
        update: { $set: movie },
        upsert: true,
      },
    })) as AnyBulkWriteOperation<MovieSchema>[];
    return operations.length ? this.movieModel.bulkWrite(operations) : null;
  }
}
