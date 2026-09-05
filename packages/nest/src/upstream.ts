import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

/**
 * What a failed call to somebody else's server is worth answering with.
 *
 * A source that says it has no such thing is the caller's business, so that
 * stays a 404. Everything else — an outage, a refusal, a deadline missed, a
 * page that will not parse — happened at the source, and a 4xx for it would
 * tell the caller to fix a request that was never wrong. 502, or the 504 a
 * missed deadline already arrives as out of `fetchWithTimeout`.
 *
 * Here rather than in each service because it is one policy: a reader hitting
 * two of our endpoints during the same outage should be told the same thing
 * twice, and the last time this rule moved, only one of its copies moved.
 *
 * `notFound` is for the endpoints that can say something better than "the
 * source has nothing" — the id the caller asked for, most of the time.
 */
export const upstreamFailure = (
  exception: any,
  source: string,
  notFound?: HttpException,
): HttpException => {
  // Ours already, and said in these terms: the 504 of a missed deadline, or
  // the 404 of a lookup that got as far as reading the answer.
  if (exception instanceof HttpException) return exception;

  const status = exception?.response?.status;
  if (status === HttpStatus.NOT_FOUND) {
    return notFound ?? new NotFoundException(`${source} has no such resource`);
  }

  // The city's error bodies carry their own sentence, which says more than
  // the status does.
  const said = exception?.response?.data?.mensaje;
  if (said) return new BadGatewayException(`${source} answered: ${said}`);
  if (status) return new BadGatewayException(`${source} answered ${status}`);
  return new BadGatewayException(
    `${source} is unreachable: ${exception?.message ?? exception}`,
  );
};
