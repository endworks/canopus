import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ErrorResponse, SearchResponse } from './app.interface';
import { Cache } from 'cache-manager';
import { lastValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';

@Injectable()
export class AppService {
  private readonly logger = new Logger('AppService');

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  public async search(term: string): Promise<SearchResponse | ErrorResponse> {
    const cache: ErrorResponse = await this.cacheManager.get(`search/${term}`);
    if (cache) return cache;

    try {
      const url = `https://dle.rae.es/srv/search?w=${term}`;
      const response = await lastValueFrom(
        this.httpService.get(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          },
        }),
      );
      const html = response.data;
      const $ = cheerio.load(html);
      const resp: SearchResponse = {
        term,
        etymology: '',
        meanings: [],
        complexForms: [],
        expressions: [],
      };
      const definitions = $('#resultados article').first();
      const lines = definitions.find('p');
      // Persists across iterations: a complex-form/expression header line sets
      // it, and the meaning lines that follow read it to route their meanings.
      let isComplexForm;
      if (lines.length >= 0) {
        lines.each((index) => {
          const line = lines.eq(index);
          if (line.hasClass('n2')) {
            resp.etymology = line.text();
          } else if (line.hasClass('k5')) {
            resp.complexForms.push({ expression: line.text(), meanings: [] });
            isComplexForm = true;
          } else if (line.hasClass('k6')) {
            resp.expressions.push({ expression: line.text(), meanings: [] });
            isComplexForm = false;
          } else if (line.hasClass('j') || line.hasClass('j2')) {
            const number = line.find('.n_acep').first().text().trim();
            const type = line.find('.d').first().text().trim();
            let country;
            try {
              country = line.find('.c').first().text().trim();
            } catch {
              country = null;
            }

            const words = line.find('mark');
            let definition = '';
            words.each((index) => {
              definition += words.eq(index).text() + ' ';
            });
            definition = definition.trim();
            resp.meanings.push({ number, type, country, definition });
          } else if (line.hasClass('m')) {
            const number = line.find('.n_acep').first().text().trim();
            const type = line.find('.d').first().text().trim();
            let country;
            try {
              country = line.find('.c').first().text().trim();
            } catch {
              country = null;
            }
            const words = line.find('mark');
            let definition = '';
            words.each((index) => {
              definition += words.eq(index).text() + ' ';
            });
            definition = definition.trim();
            if (isComplexForm) {
              resp.complexForms[resp.complexForms.length - 1].meanings.push({
                number,
                type,
                country,
                definition,
              });
            } else {
              resp.expressions[resp.expressions.length - 1].meanings.push({
                number,
                type,
                country,
                definition,
              });
            }
          }
        });
      }
      await this.cacheManager.set(`search/${term}`, resp);
      return resp;
    } catch (exception) {
      throw new InternalServerErrorException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: exception.message,
          stack: exception.stack,
        },
        exception.message,
      );
    }
  }
}
