/**
 * Fail-fast environment validation, for use with @nestjs/config's `validate`
 * hook. Throws during bootstrap (aborting startup) if a required variable is
 * missing or empty, instead of letting the service start and fail mysteriously
 * on the first request (e.g. a Mongoose connect with `undefined`).
 */
export function requireEnv<T extends Record<string, unknown>>(
  config: T,
  keys: readonly string[],
): T {
  const missing = keys.filter((key) => {
    const value = config[key];
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}`,
    );
  }
  return config;
}
