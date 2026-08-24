import { RequestTimeoutException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosRequestConfig } from 'axios';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';

export const DEFAULT_REQUEST_TIMEOUT = 10000;

/**
 * One GET with a deadline, for the scrapers. Every service was repeating this
 * pipe and its own copy of the timeout-to-408 mapping; a timeout is the one
 * failure worth naming, so it is named here and nowhere else.
 */
export const fetchWithTimeout = async <T = any>(
  http: HttpService,
  url: string,
  config?: AxiosRequestConfig & { timeoutMs?: number },
): Promise<T> => {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT, ...axiosConfig } = config ?? {};
  try {
    const response = await lastValueFrom(
      http.get<T>(url, axiosConfig).pipe(timeout(timeoutMs)),
    );
    return response.data;
  } catch (exception) {
    if (exception instanceof TimeoutError) {
      throw new RequestTimeoutException(
        'Request timeout: The API request took too long to complete',
      );
    }
    throw exception;
  }
};
