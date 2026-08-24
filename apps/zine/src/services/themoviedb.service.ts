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

  public search(
    query: string,
    lang = 'en-US',
    year = new Date().getFullYear(),
  ): Promise<TheMovieDBSearch> {
    return this.fetch(
      `themoviedb/search/${generateSlug(query)}/${lang}/${year}`,
      '/search/movie',
      {
        language: lang,
        query,
        page: '1',
        include_adult: 'true',
        year: String(year),
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
