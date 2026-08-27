import { createPrivateKey, KeyObject, sign } from 'node:crypto';

/**
 * How long a minted token stands, and how early it is replaced.
 *
 * An hour is well inside what WeatherKit accepts and short enough that a token
 * caught in transit is worth little. It is replaced five minutes early so a
 * request never leaves holding one that expires while it is in flight.
 */
const LIFETIME = 60 * 60;
const RENEW_BEFORE = 5 * 60;

const base64url = (value: Buffer | string): string =>
  Buffer.from(value).toString('base64url');

/** The four things Apple's developer portal hands out, already parsed. */
interface WeatherKitKey {
  teamId: string;
  serviceId: string;
  keyId: string;
  key: KeyObject;
}

/**
 * The private key, however the deployment managed to get it here.
 *
 * A `.p8` is a PEM block with newlines in it, and newlines do not survive the
 * trip from a secret store through a CI environment, an SSH hop and a
 * `docker run -e` intact. So base64 of the whole file is the form that
 * travels, and a raw PEM is accepted too for anyone running it by hand.
 */
export const readPrivateKey = (value: string): KeyObject =>
  createPrivateKey(
    value.includes('BEGIN') ? value : Buffer.from(value, 'base64').toString(),
  );

/**
 * A WeatherKit developer token, minted here rather than by the caller.
 *
 * The endpoint's usual bargain is that the caller brings their own key and
 * this service holds none. That bargain does not survive contact with a phone:
 * WeatherKit wants an ES256 token signed with an Apple Developer key, and an
 * app cannot hold the key to sign one — anything shipped in a bundle can be
 * read out of it. So a deployment that means to serve its own app configures
 * the key here instead, and its callers send nothing.
 *
 * Configured entirely from the environment, so nothing sensitive is in the
 * repository: see `WEATHERKIT_PRIVATE_KEY` and its three companions. A
 * deployment that sets none of them has no managed credential and the
 * bring-your-own-token path is unchanged.
 */
export class WeatherKitCredential {
  private cached?: { token: string; expires: number };

  constructor(private readonly key: WeatherKitKey) {}

  /**
   * The current token, minted on first use and reused until it is nearly out.
   *
   * Signing is a few hundred microseconds and the token is good for an hour,
   * so minting one per request would be pure waste on a path that is otherwise
   * a cache lookup.
   */
  token(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.expires - RENEW_BEFORE > now) {
      return this.cached.token;
    }

    const expires = now + LIFETIME;
    const token = this.sign(now, expires);
    this.cached = { token, expires };
    return token;
  }

  /**
   * One ES256 JWT, in the shape WeatherKit insists on.
   *
   * `id` in the header and the pair of `iss`/`sub` in the claims are Apple's
   * own arrangement rather than anything JWT asks for, and it rejects a token
   * carrying claims beyond these four.
   */
  private sign(issued: number, expires: number): string {
    const header = base64url(
      JSON.stringify({
        alg: 'ES256',
        kid: this.key.keyId,
        id: `${this.key.teamId}.${this.key.serviceId}`,
      }),
    );
    const claims = base64url(
      JSON.stringify({
        iss: this.key.teamId,
        sub: this.key.serviceId,
        iat: issued,
        exp: expires,
      }),
    );

    const input = `${header}.${claims}`;
    // `ieee-p1363` is the whole trick: JOSE wants the raw r‖s pair, and Node's
    // default for an EC key is the DER wrapping, which Apple answers 401 to.
    const signature = sign('sha256', Buffer.from(input), {
      key: this.key.key,
      dsaEncoding: 'ieee-p1363',
    });

    return `${input}.${base64url(signature)}`;
  }
}

/**
 * The credential this deployment was configured with, if it was.
 *
 * All four variables or none: a deployment holding three of them is
 * misconfigured rather than opted out, and refusing at boot says so while
 * there is still someone watching. A malformed key is refused for the same
 * reason — the alternative is every Apple request answering 401 for a reason
 * no log explains.
 */
export const weatherKitCredential = (
  env: NodeJS.ProcessEnv = process.env,
): WeatherKitCredential | undefined => {
  const teamId = env.WEATHERKIT_TEAM_ID?.trim();
  const serviceId = env.WEATHERKIT_SERVICE_ID?.trim();
  const keyId = env.WEATHERKIT_KEY_ID?.trim();
  const privateKey = env.WEATHERKIT_PRIVATE_KEY?.trim();

  const set = [teamId, serviceId, keyId, privateKey].filter(Boolean).length;
  if (set === 0) return undefined;
  if (set < 4) {
    throw new Error(
      'WeatherKit is half-configured: set all of WEATHERKIT_TEAM_ID, ' +
        'WEATHERKIT_SERVICE_ID, WEATHERKIT_KEY_ID and WEATHERKIT_PRIVATE_KEY, ' +
        'or none of them.',
    );
  }

  try {
    return new WeatherKitCredential({
      teamId: teamId as string,
      serviceId: serviceId as string,
      keyId: keyId as string,
      key: readPrivateKey(privateKey as string),
    });
  } catch (cause) {
    throw new Error(
      'WEATHERKIT_PRIVATE_KEY is not a readable P-256 private key. Send the ' +
        '.p8 base64-encoded, or as its PEM text.',
      { cause },
    );
  }
};
