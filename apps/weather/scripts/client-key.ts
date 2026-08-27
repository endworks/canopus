/**
 * Print the client key this deployment answers to, for pasting into an app.
 *
 * Derived from the WeatherKit private key rather than stored, so there is no
 * second secret to keep anywhere — see `derivedClientKey`. Reads the same
 * environment the service does, so the usual way to run it is straight out of
 * the vault:
 *
 *   WEATHERKIT_PRIVATE_KEY="$(op read 'op://end.works/Apple WeatherKit/private key')" \
 *     pnpm --filter @canopus/weather client-key
 *
 * Imports the service's own function rather than repeating the derivation: two
 * copies of it would be two chances for the printed key and the accepted key to
 * disagree, and the failure would look like a rejected client rather than a
 * mismatch.
 */
import { derivedClientKey } from '../src/providers/client-keys';

const key = derivedClientKey();

if (!key) {
  console.error(
    'WEATHERKIT_PRIVATE_KEY is not set, so there is no key to derive. Set it ' +
      '(the .p8, base64-encoded) and run this again.',
  );
  process.exit(1);
}

const version = process.env.WEATHER_CLIENT_KEY_VERSION?.trim() || '1';

// To stdout alone, so `... client-key | pbcopy` gets the key and nothing else.
console.error(
  `Client key (version ${version}) — send as X-Weather-Client-Key:`,
);
console.log(key);
