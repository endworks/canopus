import * as Sentry from '@sentry/node';

/**
 * Crash reporting, shared by every service in here.
 *
 * A service with no `SENTRY_DSN` starts and says so once, exactly as one with
 * no Mongo URI does: a clone has to run without anybody's credentials. Errors
 * only — no tracing, no profiling — because what goes wrong in these services
 * is a thing that did not happen rather than a thing that was slow, and a
 * sampled span says nothing about a notification nobody got.
 */
export function startCrashReporting(service: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    // One project, seven services: this is what tells them apart.
    initialScope: { tags: { service } },
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

/** Whether anything is listening, so a caller can skip the work of describing a failure to nobody. */
export const crashReportingOn = (): boolean => Boolean(process.env.SENTRY_DSN);

/**
 * A failure worth waking somebody for, reported at most once in a while.
 *
 * These services sweep every ten seconds. A systemic fault — an APNs key that
 * has expired, a gateway that cannot reach Mongo — is not one event but one per
 * follower per sweep, and sent whole it would bury itself and everything else.
 * The key is what makes two reports the same report; the first gets through and
 * the rest are dropped until the window is out.
 */
export function reportOnce(
  key: string,
  message: string,
  window = 600_000,
): void {
  if (!crashReportingOn()) return;
  const now = Date.now();
  const last = reported.get(key);
  if (last !== undefined && now - last < window) return;
  reported.set(key, now);
  Sentry.captureMessage(message, 'warning');
}

const reported = new Map<string, number>();
