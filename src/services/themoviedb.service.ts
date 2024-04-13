import { Inject, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { Cache } from 'cache-manager';
import {
  TheMovieDBConfiguration,
  TheMovieDBCredits,
  TheMovieDBMovie,
  TheMovieDBSearch,
  TheMovieDBVideos,
} from 'src/models/themoviedb.interface';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

const API_URL = 'https://api.themoviedb.org/3';

@Injectable()
export class TheMovieDBService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  public async configuration(): Promise<TheMovieDBConfiguration> {
    const url = `${API_URL}/configuration?api_key=${process.env.THE_MOVIE_DB_API_KEY}`;
    const cache: TheMovieDBConfiguration = await this.cacheManager.get(
      `themoviedb/configuration`,
    );
    if (cache) return cache;
    const response = await lastValueFrom(this.httpService.get(url));
    const resp = response.data;
    await this.cacheManager.set(`themoviedb/configuration`, resp);
    return response.data;
  }

  public async search(
    query: string,
    lang = 'en-US',
    year = new Date().getFullYear(),
  ): Promise<TheMovieDBSearch> {
    const url = `${API_URL}/search/movie?api_key=${process.env.THE_MOVIE_DB_API_KEY}&language=${lang}&query=${query}&page=1&include_adult=true&year=${year}`;
    const cache: TheMovieDBSearch = await this.cacheManager.get(
      `themoviedb/search/${query.replace(/\s/g, '-')}`,
    );
    if (cache) return cache;
    const response = await lastValueFrom(this.httpService.get(url));
    const resp = response.data;
    await this.cacheManager.set(
      `themoviedb/search/${query.replace(/\s/g, '-')}`,
      resp,
    );
    return response.data;
  }

  public async movie(id: number, lang = 'en-US'): Promise<TheMovieDBMovie> {
    const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${process.env.THE_MOVIE_DB_API_KEY}&language=${lang}`;
    const cache: TheMovieDBMovie = await this.cacheManager.get(
      `themoviedb/movie/${id}`,
    );
    if (cache) return cache;
    const response = await lastValueFrom(this.httpService.get(url));
    const resp = response.data;
    await this.cacheManager.set(`themoviedb/movie/${id}`, resp);
    return response.data;
  }

  public async movieCredits(
    id: number,
    lang = 'en-US',
  ): Promise<TheMovieDBCredits> {
    const url = `https://api.themoviedb.org/3/movie/${id}/credits?api_key=${process.env.THE_MOVIE_DB_API_KEY}&language=${lang}`;
    const cache: TheMovieDBCredits = await this.cacheManager.get(
      `themoviedb/movie/${id}/credits`,
    );
    if (cache) return cache;
    const response = await lastValueFrom(this.httpService.get(url));
    const resp = response.data;
    await this.cacheManager.set(`themoviedb/movie/${id}/credits`, resp);
    return response.data;
  }

  public async movieVideos(
    id: number,
    lang = 'en-US',
  ): Promise<TheMovieDBVideos> {
    const url = `https://api.themoviedb.org/3/movie/${id}/videos?api_key=${process.env.THE_MOVIE_DB_API_KEY}&language=${lang}`;
    const cache: TheMovieDBVideos = await this.cacheManager.get(
      `themoviedb/movie/${id}/videos`,
    );
    if (cache) return cache;
    const response = await lastValueFrom(this.httpService.get(url));
    const resp = response.data;
    await this.cacheManager.set(`themoviedb/movie/${id}/videos`, resp);
    return response.data;
  }
}
