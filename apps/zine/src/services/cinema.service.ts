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
  TheMovieDBSearchResult,
} from '../models/themoviedb.interface';
import { Cinema as CinemaSchema } from '../schemas/cinema.schema';
import { Movie as MovieSchema } from '../schemas/movie.schema';
import { Match, pickBest, searchQueries, shortlist } from '../movie-matcher';
import { minutesToString } from '../utils';
import { CinemaSources } from './cinema-source';
import { TheMovieDBService } from './themoviedb.service';

const LANG = 'es-ES';
const REGION = 'ES';

/** Long runs and re-releases sit on a billboard for months. */
const BILLBOARD_LOOKBACK_DAYS = 180;

/** Previews and advance listings run slightly ahead of the release date. */
const BILLBOARD_LOOKAHEAD_DAYS = 30;

/** 20 results a page — enough to cover a national billboard, not the archive. */
const MAX_BILLBOARD_PAGES = 10;

const isoDate = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const describe = (match: Match): string =>
  `'${match.movie.title}' (${match.score.toFixed(2)}, ${match.movie.runtime} min)`;

/** Mongo bookkeeping fields never belong in an RPC response. */
const stripMongoFields = <T>({ _id, __v, ...rest }: T & Record<string, any>) =>
  rest;

@Injectable()
export class CinemaService {
  private readonly logger = new Logger(CinemaService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectModel(CinemaSchema.name) private cinemaModel: Model<CinemaSchema>,
    @InjectModel(MovieSchema.name) private movieModel: Model<MovieSchema>,
    private sources: CinemaSources,
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

    const movies = await this.sources
      .for(cinema.source)
      .getMovies(cinema.source);
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
    const catalogues = await Promise.all(
      this.sources.all().map(async (source) => {
        try {
          return await source.getCinemas();
        } catch (exception) {
          this.logger.error(
            `failed to list cinemas from '${source.host}': ${exception.message}`,
          );
          return [];
        }
      }),
    );
    await this.saveCinemas(this.sources.dedupe(catalogues.flat()));
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
    const match = await this.findMatch(movie);
    if (!match) return movie;
    const movieDB = match.movie;

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
   * Every film with a Spanish theatrical release row in the billboard window.
   * A few paged calls, cached and shared across every cinema and film, giving a
   * small high-precision candidate set to match against locally instead of one
   * text search per title.
   */
  private billboard(): Promise<TheMovieDBSearchResult[]> {
    const from = isoDate(-BILLBOARD_LOOKBACK_DAYS);
    const to = isoDate(BILLBOARD_LOOKAHEAD_DAYS);
    return this.cacheManager.wrap(
      `themoviedb/billboard/${REGION}/${from}/${to}`,
      async () => {
        const first = await this.theMovieDb.releasedIn(
          REGION,
          from,
          to,
          1,
          LANG,
        );
        const pages = Math.min(first.total_pages ?? 1, MAX_BILLBOARD_PAGES);
        const rest = await Promise.all(
          Array.from({ length: Math.max(pages - 1, 0) }, (_, index) =>
            this.theMovieDb.releasedIn(REGION, from, to, index + 2, LANG),
          ),
        );
        const results = [first, ...rest].flatMap((page) => page.results ?? []);
        this.logger.log(
          `billboard: ${results.length} films released in ${REGION} between ${from} and ${to}`,
        );
        return results;
      },
    );
  }

  /**
   * Find the TheMovieDB record for a scraped billboard entry.
   *
   * The Spanish release window is tried first: it is a small, high-precision
   * set, so a hit there is almost certainly the right film. Text search is the
   * fallback, because regional release rows are contributor-supplied and thin
   * for art-house and small-distributor runs — exactly the long tail. Within
   * each source, queries run from most to least specific.
   *
   * Title similarity decides; runtime only breaks ties, so a re-release with a
   * restored runtime still matches instead of being thrown away.
   */
  private async findMatch(movie: Movie): Promise<Match | null> {
    // SensaCine states the original title; it is often what TheMovieDB indexes.
    const queries = [
      ...new Set([
        ...searchQueries(movie.name),
        ...(movie.originalName ? searchQueries(movie.originalName) : []),
      ]),
    ];

    for (const query of queries) {
      const match = await this.bestOf(
        query,
        movie,
        shortlist(query, await this.spanishReleases()),
      );
      if (match) {
        this.logger.debug(
          `matched '${movie.name}' via billboard: ${describe(match)}`,
        );
        return match;
      }
    }

    for (const query of queries) {
      const { results } = await this.theMovieDb.search(query, LANG);
      const match = await this.bestOf(
        query,
        movie,
        shortlist(query, results ?? []),
      );
      if (match) {
        this.logger.debug(
          `matched '${movie.name}' via search: ${describe(match)}`,
        );
        return match;
      }
    }

    // Expected for art-house programming and local premieres, so this is a
    // warning rather than an error; the queries are logged so the next tuning
    // pass can see exactly what was asked for.
    this.logger.warn(
      `no TheMovieDB match for '${movie.name}' (tried: ${queries.join(', ')})`,
    );
    return null;
  }

  /** The billboard is an optimisation — never let it fail the enrichment. */
  private async spanishReleases(): Promise<TheMovieDBSearchResult[]> {
    try {
      return await this.billboard();
    } catch (exception) {
      this.logger.warn(
        `billboard lookup failed, falling back to search: ${exception.message}`,
      );
      return [];
    }
  }

  /** Resolve a shortlist to full records and take the best combined score. */
  private async bestOf(
    query: string,
    movie: Movie,
    candidates: TheMovieDBSearchResult[],
  ): Promise<Match | null> {
    if (candidates.length === 0) return null;
    const details = await Promise.all(
      candidates.map((candidate) => this.theMovieDb.movie(candidate.id, LANG)),
    );
    return pickBest(query, movie.duration, details);
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
