import { HttpService } from '@nestjs/axios';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import {
  TheMovieDBConfiguration,
  TheMovieDBCredits,
  TheMovieDBMovie,
  TheMovieDBSearch,
  TheMovieDBVideos,
} from '../models/themoviedb.interface';
import { generateSlug } from '../utils';

const API_URL = 'https://api.themoviedb.org/3';

@Injectable()
export class TheMovieDBService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  /**
   * Cached GET against TheMovieDB. `wrap` also coalesces concurrent misses on
   * the same key, so the per-movie fan-out in CinemaService issues one request
   * per unique resource rather than one per caller.
   */
  private fetch<T>(
    key: string,
    path: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const query = new URLSearchParams({
      api_key: process.env.THE_MOVIE_DB_API_KEY,
      ...params,
    });
    return this.cacheManager.wrap(key, async () => {
      const { data } = await lastValueFrom(
        this.httpService.get<T>(`${API_URL}${path}?${query}`),
      );
      return data;
    });
  }

  public configuration(): Promise<TheMovieDBConfiguration> {
    return this.fetch('themoviedb/configuration', '/configuration');
  }

  /**
   * No `year` filter. It is a hard filter, and it tests TheMovieDB's per-country
   * release-date rows — which are contributor-supplied and thin for Spain. A
   * re-release only surfaces under the current year if someone added a Spanish
   * release row for it, so pinning the year hides exactly what a billboard is
   * full of: re-releases, restorations and films that opened abroad years ago.
   */
  public search(query: string, lang = 'en-US'): Promise<TheMovieDBSearch> {
    return this.fetch(
      `themoviedb/search/${generateSlug(query)}/${lang}`,
      '/search/movie',
      { language: lang, query, page: '1', include_adult: 'true' },
    );
  }

  /**
   * Films with a theatrical or limited-theatrical release row in `region`
   * inside the window. Same engine as /movie/now_playing, but the window is
   * explicit, so long runs and re-releases stay in range instead of falling out
   * of TheMovieDB's own fixed ~7-week span.
   */
  public releasedIn(
    region: string,
    from: string,
    to: string,
    page = 1,
    lang = 'en-US',
  ): Promise<TheMovieDBSearch> {
    return this.fetch(
      `themoviedb/discover/${region}/${from}/${to}/${lang}/${page}`,
      '/discover/movie',
      {
        language: lang,
        region,
        with_release_type: '2|3',
        'release_date.gte': from,
        'release_date.lte': to,
        include_adult: 'true',
        page: String(page),
      },
    );
  }

  public movie(id: number, lang = 'en-US'): Promise<TheMovieDBMovie> {
    return this.fetch(`themoviedb/movie/${id}`, `/movie/${id}`, {
      language: lang,
    });
  }

  public movieCredits(id: number, lang = 'en-US'): Promise<TheMovieDBCredits> {
    return this.fetch(
      `themoviedb/movie/${id}/credits`,
      `/movie/${id}/credits`,
      { language: lang },
    );
  }

  public movieVideos(id: number, lang = 'en-US'): Promise<TheMovieDBVideos> {
    return this.fetch(`themoviedb/movie/${id}/videos`, `/movie/${id}/videos`, {
      language: lang,
    });
  }
}
