import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { fetchWithTimeout, upstreamFailure } from '@canopus/nest';
import { AxiosRequestConfig, isAxiosError } from 'axios';

/**
 * One upstream GET, with the provider's refusals said in our own terms.
 *
 * The status a provider answers with is about the caller's key far more often
 * than about us — a spent quota, a key that has not warmed up yet, a plan that
 * does not carry the endpoint — and a caller who supplied that key can act on
 * every one of those. Collapsing them all into a 500 is the one thing that
 * would make this endpoint harder to use than calling the provider directly.
 *
 * `config` is here for the providers that carry the caller's credential in a
 * header rather than in the query string — WeatherKit wants a signed token in
 * `Authorization` — and for nothing else. Nothing in it may change the answer
 * without also changing the cache key the caller built, or one caller's data
 * would be served to another.
 */
export const upstreamGet = async <T>(
  http: HttpService,
  url: string,
  provider: string,
  config?: AxiosRequestConfig & { timeoutMs?: number },
): Promise<T> => {
  try {
    return await fetchWithTimeout<T>(http, url, config);
  } catch (exception) {
    const status = isAxiosError(exception) && exception.response?.status;
    if (status === 401 || status === 403) {
      throw new UnauthorizedException(`${provider} rejected the API key`);
    }
    if (status === 429) {
      throw new HttpException(
        `${provider} rate limit exceeded for this API key`,
        429,
      );
    }
    // The rest is what every service does with somebody else's outage: the
    // 504 of a missed deadline passed through, a 404 said in our own words,
    // and 502 for everything the provider did to us.
    throw upstreamFailure(
      exception,
      provider,
      new NotFoundException(`${provider} has no data for that place`),
    );
  }
};
