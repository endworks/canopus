import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readPrivateKey } from './weatherkit-credential';

/**
 * What the derived key is derived *for*, so the same secret could safely be
 * stretched into another one later without the two colliding.
 */
const PURPOSE = 'canopus:weather:client-key';

/** Bumped to rotate the derived key without touching Apple. */
const DEFAULT_VERSION = '1';

/**
 * Who is allowed to spend this deployment's own quota.
 *
 * Only ever consulted for a provider whose credential the deployment holds —
 * see `ProviderInfo.managed`. A caller who brings their own key is spending
 * their own quota and needs no permission from us; a caller falling back to
 * ours is spending a finite thing somebody else pays for, and a public URL
 * with no gate in front of it is a way to lose all of it in an afternoon.
 *
 * This is a shared secret, not an identity. It says the caller is one of ours,
 * not which one — enough to keep an endpoint from being an open proxy, and not
 * a substitute for real authentication if this ever serves more than its own
 * apps.
 */
export class ClientKeys {
  /**
   * The keys as fixed-width digests.
   *
   * Hashed so the comparison below has two equal-length buffers whatever the
   * keys are — `timingSafeEqual` throws on a length mismatch, and branching on
   * length beforehand would leak it. Not hashed for storage's sake: these come
   * from the environment already, and a digest here protects nothing that the
   * process memory does not already hold.
   */
  private readonly digests: Buffer[];

  constructor(keys: string[]) {
    this.digests = keys.map((key) => createHash('sha256').update(key).digest());
  }

  /** Whether any key was configured at all. */
  get configured(): boolean {
    return this.digests.length > 0;
  }

  /**
   * Whether this is one of ours, compared without leaking how nearly it was.
   *
   * Every key is checked even after a match, so the time taken says nothing
   * about which one matched or how far down the list it was.
   */
  allows(candidate?: string): boolean {
    const key = candidate?.trim();
    if (!key || !this.configured) return false;

    const digest = createHash('sha256').update(key).digest();
    return this.digests.reduce(
      (matched, known) => timingSafeEqual(known, digest) || matched,
      false,
    );
  }
}

/**
 * A client key stretched out of the WeatherKit private key already configured.
 *
 * The point is that a deployment needs no secret it did not already have. The
 * obvious shortcut — reusing the Team ID, the Service ID or the Key ID as the
 * shared secret — does not work: none of the three is secret. A Team ID sits in
 * the `embedded.mobileprovision` of every build, a Service ID is public the
 * moment it is used for Sign in with Apple and is guessable regardless, and a
 * Key ID is the middle of the `.p8`'s own filename. A gate whose secret ships
 * inside the thing it guards is not a gate.
 *
 * The private key is the one value in that set that genuinely is a secret, so
 * this is an HMAC of it. One-way, so the key that ends up in an app bundle
 * tells an attacker nothing about the key it came from, and deterministic, so
 * it can be recomputed rather than stored. `WEATHER_CLIENT_KEY_VERSION` is the
 * rotation handle: bump it, redeploy, ship the clients — no new Apple key and
 * no new field in the vault.
 */
export const derivedClientKey = (
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  const privateKey = env.WEATHERKIT_PRIVATE_KEY?.trim();
  if (!privateKey) return undefined;

  // Through the parser rather than off the environment string, so the key does
  // not change when the same `.p8` is handed over as PEM instead of base64.
  const canonical = readPrivateKey(privateKey).export({
    type: 'pkcs8',
    format: 'der',
  });
  const version = env.WEATHER_CLIENT_KEY_VERSION?.trim() || DEFAULT_VERSION;

  return createHmac('sha256', canonical)
    .update(`${PURPOSE}:${version}`)
    .digest('base64url');
};

/**
 * The keys this deployment answers to.
 *
 * `WEATHER_CLIENT_KEYS` wins outright where it is set — comma-separated, so a
 * key can be rotated without a moment where none works, and so a deployment
 * that would rather manage its own secrets simply does. Where it is not set,
 * the key derived above is the only one, which is what makes the WeatherKit
 * credential deployable without inventing a second secret to guard it.
 */
export const clientKeys = (
  env: NodeJS.ProcessEnv = process.env,
): ClientKeys => {
  const explicit = (env.WEATHER_CLIENT_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  if (explicit.length > 0) return new ClientKeys(explicit);

  const derived = derivedClientKey(env);
  return new ClientKeys(derived ? [derived] : []);
};
