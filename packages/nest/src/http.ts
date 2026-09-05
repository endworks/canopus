import { GatewayTimeoutException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosRequestConfig } from 'axios';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';

export const DEFAULT_REQUEST_TIMEOUT = 10000;

/**
 * One request with a deadline, for the scrapers. Every service was repeating
 * this pipe and its own copy of the timeout mapping; a timeout is the one
 * failure worth naming, so it is named here and nowhere else.
 *
 * It is named 504, not 408: the deadline that ran out is the one we set on a
 * request we made, and 408 would tell our own caller it was too slow sending
 * a request that arrived intact. What the source does answer with is read by
 * `upstreamFailure`, beside this.
 */

/** One form POST, for what a site answers only to a form. */
export const postWithTimeout = async <T = any>(
  http: HttpService,
  url: string,
  form: Record<string, string>,
  config?: AxiosRequestConfig & { timeoutMs?: number },
): Promise<T> => {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT, ...axiosConfig } = config ?? {};
  try {
    const response = await lastValueFrom(
      http
        .post<T>(url, new URLSearchParams(form).toString(), {
          ...axiosConfig,
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            ...axiosConfig.headers,
          },
        })
        .pipe(timeout(timeoutMs)),
    );
    return response.data;
  } catch (exception) {
    if (exception instanceof TimeoutError) {
      throw new GatewayTimeoutException(
        'Request timeout: The API request took too long to complete',
      );
    }
    throw exception;
  }
};

/** One GET. */
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
      throw new GatewayTimeoutException(
        'Request timeout: The API request took too long to complete',
      );
    }
    throw exception;
  }
};
