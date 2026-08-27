import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { fetchWithTimeout } from '@canopus/nest';
import { isAxiosError } from 'axios';

/**
 * One upstream GET, with the provider's refusals said in our own terms.
 *
 * The status a provider answers with is about the caller's key far more often
 * than about us — a spent quota, a key that has not warmed up yet, a plan that
 * does not carry the endpoint — and a caller who supplied that key can act on
 * every one of those. Collapsing them all into a 500 is the one thing that
 * would make this endpoint harder to use than calling the provider directly.
 */
export const upstreamGet = async <T>(
  http: HttpService,
  url: string,
  provider: string,
): Promise<T> => {
  try {
    return await fetchWithTimeout<T>(http, url);
  } catch (exception) {
    // A timeout already arrives as the 408 `fetchWithTimeout` names it.
    if (exception instanceof HttpException) throw exception;
    if (!isAxiosError(exception) || !exception.response) {
      throw new BadGatewayException(
        `${provider} is unreachable: ${(exception as Error).message}`,
      );
    }
    const { status } = exception.response;
    if (status === 401 || status === 403) {
      throw new UnauthorizedException(`${provider} rejected the API key`);
    }
    if (status === 404) {
      throw new NotFoundException(`${provider} has no data for that place`);
    }
    if (status === 429) {
      throw new HttpException(
        `${provider} rate limit exceeded for this API key`,
        429,
      );
    }
    throw new BadGatewayException(`${provider} answered ${status}`);
  }
};
