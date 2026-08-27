import { generateKeyPairSync } from 'node:crypto';
import { ClientKeys, clientKeys, derivedClientKey } from './client-keys';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const p8 = Buffer.from(pem).toString('base64');

describe('clientKeys', () => {
  it('reads a comma-separated list, so a key can be rotated', () => {
    // Two valid at once is the whole point: add the new one, ship the clients,
    // then drop the old one — never a moment where none works.
    const keys = clientKeys({ WEATHER_CLIENT_KEYS: ' old , new ' });

    expect(keys.allows('old')).toBe(true);
    expect(keys.allows('new')).toBe(true);
    expect(keys.configured).toBe(true);
  });

  it('is unconfigured when nothing is set', () => {
    expect(clientKeys({}).configured).toBe(false);
    expect(clientKeys({ WEATHER_CLIENT_KEYS: '  ,, ' }).configured).toBe(false);
  });

  it('derives a key from the WeatherKit secret, so none has to be invented', () => {
    const keys = clientKeys({ WEATHERKIT_PRIVATE_KEY: p8 });
    const derived = derivedClientKey({ WEATHERKIT_PRIVATE_KEY: p8 }) as string;

    expect(keys.allows(derived)).toBe(true);
    // 32 bytes of HMAC: not something anyone guesses, unlike the Team ID,
    // Service ID and Key ID that ship inside every build.
    expect(Buffer.from(derived, 'base64url')).toHaveLength(32);
  });

  it('derives the same key whether the .p8 arrives as base64 or PEM', () => {
    // The two spellings are the same secret, and a deployment that switched
    // between them must not start rejecting its own clients.
    expect(derivedClientKey({ WEATHERKIT_PRIVATE_KEY: p8 })).toBe(
      derivedClientKey({ WEATHERKIT_PRIVATE_KEY: pem }),
    );
  });

  it('rotates on the version, without touching Apple', () => {
    const first = derivedClientKey({ WEATHERKIT_PRIVATE_KEY: p8 });
    const second = derivedClientKey({
      WEATHERKIT_PRIVATE_KEY: p8,
      WEATHER_CLIENT_KEY_VERSION: '2',
    });

    expect(second).not.toBe(first);
    expect(
      clientKeys({
        WEATHERKIT_PRIVATE_KEY: p8,
        WEATHER_CLIENT_KEY_VERSION: '2',
      }).allows(first as string),
    ).toBe(false);
  });

  it('derives a different key from a different .p8', () => {
    const { privateKey: other } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });

    expect(
      derivedClientKey({
        WEATHERKIT_PRIVATE_KEY: Buffer.from(
          other.export({ type: 'pkcs8', format: 'pem' }) as string,
        ).toString('base64'),
      }),
    ).not.toBe(derivedClientKey({ WEATHERKIT_PRIVATE_KEY: p8 }));
  });

  it('lets an explicit list take over from the derived key', () => {
    const keys = clientKeys({
      WEATHERKIT_PRIVATE_KEY: p8,
      WEATHER_CLIENT_KEYS: 'mine',
    });

    expect(keys.allows('mine')).toBe(true);
    // Taking over means taking over: the derived key stops being accepted, so
    // a deployment that sets this knows exactly what it answers to.
    expect(keys.allows(derivedClientKey({ WEATHERKIT_PRIVATE_KEY: p8 }))).toBe(
      false,
    );
  });

  it('allows nothing at all when unconfigured', () => {
    // The service refuses to boot into this combination, but the class must
    // not be the thing that fails open if it ever gets here.
    const keys = new ClientKeys([]);

    expect(keys.allows('anything')).toBe(false);
    expect(keys.allows('')).toBe(false);
    expect(keys.allows(undefined)).toBe(false);
  });

  it('rejects near misses of any length', () => {
    const keys = new ClientKeys(['s3cret']);

    expect(keys.allows('s3cret')).toBe(true);
    // A prefix, a suffix and a different case are all simply wrong — and a
    // longer candidate must be rejected rather than throwing on the
    // length mismatch that `timingSafeEqual` would otherwise raise.
    expect(keys.allows('s3cre')).toBe(false);
    expect(keys.allows('s3cretsss')).toBe(false);
    expect(keys.allows('S3CRET')).toBe(false);
  });

  it('ignores whitespace around the key a client sent', () => {
    expect(new ClientKeys(['s3cret']).allows(' s3cret ')).toBe(true);
  });
});
