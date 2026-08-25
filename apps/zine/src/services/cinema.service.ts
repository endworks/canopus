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
  PruneReport,
  Movie,
  MovieBasic,
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
import { minutesToString, venueKey } from '../utils';
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

/** Accents and capitalisation vary between sources, so neither may decide order. */
const collator = new Intl.Collator('es', { sensitivity: 'base' });

/** Absent values sort last rather than ahead of every name. */
const compareText = (a?: string, b?: string): number => {
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  return collator.compare(a, b);
};

/**
 * The listing reads as an alphabetical index: city first, then venue name.
 * Names sort on their venue key, so 'Cines Palafox' files under P.
 */
const byCityThenName = (a: Cinema, b: Cinema): number =>
  compareText(a.location, b.location) ||
  compareText(venueKey(a.name), venueKey(b.name));

/**
 * Newest release first. Release dates are ISO `YYYY-MM-DD`, so comparing them
 * as text is chronological. A film with no known release date sorts last:
 * reservaentradas never states one, and an unknown date is not a new one.
 */
const byReleaseDateDesc = (a: MovieBasic, b: MovieBasic): number => {
  if (!a.releaseDate) return b.releaseDate ? 1 : 0;
  if (!b.releaseDate) return -1;
  return b.releaseDate.localeCompare(a.releaseDate);
};

/** Comma-separated and case-insensitive; no filter matches every city. */
const locationFilter = (location?: string) => {
  const locations = location?.toLowerCase().split(',');
  return (value?: string) =>
    !locations || locations.includes(value?.toLowerCase());
};

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
      const matches = locationFilter(location);
      // Sorted by id in Mongo so venues sharing a city and name keep a stable
      // order; the alphabetical sort below is stable and preserves it.
      const cinemas = await this.cinemaModel.find().sort({ id: 1 }).lean();
      return (
        cinemas
          .filter((cinema) => matches(cinema.location))
          .map(stripMongoFields) as Cinema[]
      ).sort(byCityThenName);
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

    const movies = (
      await this.sources.for(cinema.source).getMovies(cinema.source)
    ).sort(byReleaseDateDesc);
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

    // The billboard is keyed by scraped title here, not by film. Only
    // getCinema resolves the TheMovieDB ids the rest of the service stores, so
    // writing these would put a second, private id space in the same fields.
    await this.saveCinema({ id, lastUpdated: resp.lastUpdated });
    await this.cacheManager.set(`cinema/${id}/basic`, resp);
    return resp;
  }

  /** Showtimes plus TheMovieDB metadata for every film on the billboard. */
  public async getCinema(id: string): Promise<CinemaDetails> {
    const cached: CinemaDetails = await this.cacheManager.get(`cinema/${id}`);
    if (cached) return cached;

    const cinema = await this.getCinemaBasic(id);
    const scraped = cinema.movies as Movie[];

    let matched: Movie[];
    try {
      const config = await this.theMovieDb.configuration();
      const enriched = await Promise.all(
        scraped.map((movie) => this.enrichMovie(movie, config)),
      );
      matched = enriched.filter((movie): movie is Movie => movie !== null);
    } catch (exception) {
      // Enrichment is best-effort: fall back to the scraped billboard rather
      // than failing a request that already has showtimes to return. Those
      // films are still keyed by title, so this response is never persisted
      // or cached, and the next request retries.
      this.logger.error(
        `TheMovieDB enrichment failed for cinema '${id}', returning basic data: ${exception.message}`,
      );
      return this.toCinemaDetails(cinema, scraped);
    }

    if (matched.length < scraped.length) {
      this.logger.warn(
        `cinema '${id}': dropped ${scraped.length - matched.length} of ${scraped.length} films with no TheMovieDB match`,
      );
    }

    const resp = this.toCinemaDetails(
      cinema,
      this.byFilm(matched, cinema.sessions),
    );
    await this.saveMovies(resp.movies);
    await this.saveCinema({
      ...resp,
      movies: resp.movies.map((movie) => movie.id),
    });
    await this.cacheManager.set(`cinema/${id}`, resp);
    return resp;
  }

  /**
   * Every film on a current billboard, newest first, each carrying the cinemas
   * showing it. Derived from the cinemas rather than stored on the film: a
   * billboard changes every week, so a persisted copy would be stale by the
   * next scrape.
   */
  public getMovies(location?: string): Promise<Movie[]> {
    const key = location ? `movies/${location}` : 'movies';
    return this.cacheManager.wrap(key, async () => {
      const matches = locationFilter(location);
      // Sorted by id so a film's list of cinemas has a stable order.
      const cinemas = await this.cinemaModel
        .find({}, 'id location movies')
        .sort({ id: 1 })
        .lean();

      const showing = new Map<string, string[]>();
      for (const cinema of cinemas) {
        if (!matches(cinema.location)) continue;
        for (const id of cinema.movies ?? []) {
          showing.set(id, [...(showing.get(id) ?? []), cinema.id]);
        }
      }

      // Films that fell off every billboard stay in the collection but are not
      // showing anywhere, so they are never asked for here.
      const movies = await this.movieModel
        .find({ id: { $in: [...showing.keys()] } })
        .lean();
      return (
        movies.map((movie) => ({
          ...stripMongoFields(movie),
          cinemas: showing.get(movie.id),
        })) as Movie[]
      ).sort(byReleaseDateDesc);
    });
  }

  public async cached(): Promise<CacheData> {
    const caches = await this.listCacheKeys();
    return { cacheSize: `${caches.length}`, caches };
  }

  /**
   * Drop what the catalogue no longer accounts for.
   *
   * Nothing here carries a timestamp, so staleness is reachability, not age: a
   * venue neither site lists any more, and then a film no remaining venue is
   * showing. That makes a failed scrape indistinguishable from a closed
   * cinema, so the whole run is skipped unless every source returned a
   * catalogue — better to prune nothing today than to empty the collection
   * because one site was down.
   */
  public async prune(): Promise<PruneReport> {
    const catalogues = await Promise.all(
      this.sources.all().map(async (source) => {
        try {
          return await source.getCinemas();
        } catch (exception) {
          this.logger.error(
            `failed to list cinemas from '${source.host}': ${exception.message}`,
          );
          return null;
        }
      }),
    );

    const empty = {
      pruned: false,
      cinemas: 0,
      movies: 0,
      sessions: 0,
      caches: 0,
    };
    if (catalogues.some((catalogue) => !catalogue?.length)) {
      const reason = 'a source returned no cinemas, so nothing was pruned';
      this.logger.warn(reason);
      return { ...empty, reason };
    }

    const live = this.sources.dedupe(catalogues.flat());
    const liveIds = new Set(live.map((cinema) => cinema.id));

    const { deletedCount = 0 } = await this.cinemaModel.deleteMany({
      id: { $nin: [...liveIds] },
    });
    const sessions = await this.dropPastSessions();
    const movies = await this.dropUnwatchableMovies();
    // What a prune deletes is reachable from more than one cache key — the
    // city lists and the unfiltered listings included — so picking at the
    // keys named after a venue would still serve it for the rest of the TTL.
    let caches = 0;
    if (deletedCount || movies || sessions) {
      caches = (await this.listCacheKeys()).length;
      await this.cacheManager.clear();
    }

    this.logger.log(
      `pruned ${deletedCount} cinemas, ${movies} films, ${sessions} showtimes, ${caches} cache entries`,
    );
    return { pruned: true, cinemas: deletedCount, movies, sessions, caches };
  }

  /**
   * Drop showtimes that have already happened, and any film left with none:
   * a billboard is what you can still go and see. Sessions the listing gave no
   * date for are kept, since there is nothing to judge them by.
   */
  private async dropPastSessions(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const cinemas = await this.cinemaModel
      .find({}, 'id movies sessions')
      .lean();
    const operations: AnyBulkWriteOperation<CinemaSchema>[] = [];
    let dropped = 0;

    for (const cinema of cinemas) {
      const sessions: Record<string, Session[]> = {};
      const before = Object.values(cinema.sessions ?? {}).flat().length;
      for (const [film, showings] of Object.entries(cinema.sessions ?? {})) {
        const upcoming = showings.filter(
          (session) => !session.date || session.date >= today,
        );
        if (upcoming.length) sessions[film] = upcoming;
      }
      const after = Object.values(sessions).flat().length;
      if (after === before) continue;
      dropped += before - after;
      operations.push({
        updateOne: {
          filter: { id: cinema.id },
          update: {
            $set: {
              sessions,
              movies: (cinema.movies ?? []).filter((film) => sessions[film]),
            },
          },
        },
      });
    }

    if (operations.length) await this.cinemaModel.bulkWrite(operations);
    return dropped;
  }

  /** Films no remaining cinema is showing: nothing links to them any more. */
  private async dropUnwatchableMovies(): Promise<number> {
    const cinemas = await this.cinemaModel.find({}, 'movies').lean();
    const showing = new Set(cinemas.flatMap((cinema) => cinema.movies ?? []));
    const { deletedCount = 0 } = await this.movieModel.deleteMany({
      id: { $nin: [...showing] },
    });
    return deletedCount;
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
    const listed = catalogues.flat();
    const catalogue = this.sources.dedupe(listed);
    await this.saveCinemas(catalogue);
    await this.dropMergedVenues(listed, catalogue);
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
    // Sorted again because enrichment is what fills most release dates in:
    // the scraped order this started from knew almost none of them.
    const films = movies
      .map((movie) => this.normalizeMovie(movie, cinema.sessions))
      .sort(byReleaseDateDesc);
    return {
      ...cinema,
      // Rebuilt rather than carried over: enrichment re-keys the billboard by
      // film, so the map the scrape produced is keyed by titles that are gone.
      sessions: Object.fromEntries(
        films.map((film) => [film.id, film.sessions]),
      ),
      movies: films,
    };
  }

  /**
   * Key the billboard by film rather than by the title a site printed.
   *
   * Two scraped entries are often one film — a dubbed listing and a subtitled
   * one, a re-release, or the same title spelt differently by the two sites —
   * so their showtimes are pooled instead of one overwriting the other.
   */
  private byFilm(
    movies: Movie[],
    sessions?: Record<string, Session[]>,
  ): Movie[] {
    const films = new Map<string, Movie>();
    for (const movie of movies) {
      const id = String(movie.theMovieDbId);
      const showings = movie.sessions ?? sessions?.[movie.id] ?? [];
      const seen = films.get(id);
      if (seen) {
        seen.sessions = [...seen.sessions, ...showings];
        continue;
      }
      films.set(id, { ...movie, id, sessions: [...showings] });
    }
    return [...films.values()];
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

  /**
   * Overlay a scraped movie with TheMovieDB metadata, or drop it.
   *
   * A film TheMovieDB doesn't know has no id to be keyed by and no metadata to
   * show, and the same title printed differently by the two sites would land
   * as two films, so it is left off the billboard entirely.
   */
  private async enrichMovie(
    movie: Movie,
    config: TheMovieDBConfiguration,
  ): Promise<Movie | null> {
    const match = await this.findMatch(movie);
    if (!match) return null;
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
   * A venue the dedupe now merges away may have been saved as a cinema of its
   * own by an earlier run, and upserting never removes it. Without this the
   * merged listing keeps showing up, with its own copy of the billboard —
   * every film on it duplicated under whatever title the other site prints.
   *
   * Only venues seen in this run's listings are dropped, so a source that
   * failed and returned nothing can never delete the venues it owns.
   */
  private async dropMergedVenues(listed: Cinema[], kept: Cinema[]) {
    const keptIds = new Set(kept.map((cinema) => cinema.id));
    const merged = listed
      .map((cinema) => cinema.id)
      .filter((id) => !keptIds.has(id));
    if (!merged.length) return;
    this.logger.log(`dropping ${merged.length} merged venues`);
    await this.cinemaModel.deleteMany({ id: { $in: merged } });
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
          // The seed still wins, but the listings carry an address of their
          // own now, so an unseeded venue keeps the one it was scraped with.
          update: {
            $set: { ...cinema, address: address ?? cinema.address, website },
          },
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
