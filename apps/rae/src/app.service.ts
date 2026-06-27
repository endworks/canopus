import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ErrorResponse, Meaning, SearchResponse } from './app.interface';
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
      // Definitions and headers, in document order. The DLE markup nests the
      // gloss line inside `li.j`/`li.j2` (senses), `li.m` (sub-senses) and
      // `h3.k5`/`h3.k6` (complex-form/expression headers); `.n2` is etymology.
      const lines = definitions.find('.n2, li.j, li.j2, li.m, h3.k5, h3.k6');

      const extract = (line: typeof definitions): Meaning => {
        const body = line.find('.c-definitions__item > div').first();
        const number = body.find('.n_acep').first().text().trim();
        // The grammar category (e.g. `f.`, `m.`) is always the first abbr.
        const type = body.find('abbr').first().text().trim();
        const country = body.find('abbr.c').first().text().trim() || null;
        const gloss = body.clone();
        gloss.find('.n_acep, .h').remove(); // drop number and usage examples
        gloss.find('abbr.c').remove(); // drop country marker
        gloss.find('abbr').first().remove(); // drop grammar category
        const definition = gloss.text().replace(/\s+/g, ' ').trim();
        return { number, type, country, definition };
      };

      // Persists across iterations: a complex-form/expression header line sets
      // it, and the meaning lines that follow read it to route their meanings.
      let isComplexForm;
      lines.each((index) => {
        const line = lines.eq(index);
        if (line.hasClass('n2')) {
          resp.etymology = line.text().replace(/\s+/g, ' ').trim();
        } else if (line.hasClass('k5')) {
          resp.complexForms.push({
            expression: line.text().trim(),
            meanings: [],
          });
          isComplexForm = true;
        } else if (line.hasClass('k6')) {
          resp.expressions.push({
            expression: line.text().trim(),
            meanings: [],
          });
          isComplexForm = false;
        } else if (line.hasClass('j') || line.hasClass('j2')) {
          resp.meanings.push(extract(line));
        } else if (line.hasClass('m')) {
          const meaning = extract(line);
          if (isComplexForm) {
            resp.complexForms[resp.complexForms.length - 1].meanings.push(
              meaning,
            );
          } else {
            resp.expressions[resp.expressions.length - 1].meanings.push(
              meaning,
            );
          }
        }
      });
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
