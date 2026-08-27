import { generateKeyPairSync, verify } from 'node:crypto';
import { weatherKitCredential } from './weatherkit-credential';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});

const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const env = (overrides: Record<string, string | undefined> = {}) => ({
  WEATHERKIT_TEAM_ID: 'ABCDE12345',
  WEATHERKIT_SERVICE_ID: 'com.example.weather',
  WEATHERKIT_KEY_ID: 'FGHIJ67890',
  WEATHERKIT_PRIVATE_KEY: Buffer.from(pem).toString('base64'),
  ...overrides,
});

/** The three parts of a JWT, as the far end would take them apart. */
const parts = (token: string) => {
  const [header, claims, signature] = token.split('.');
  const json = (part: string) =>
    JSON.parse(Buffer.from(part, 'base64url').toString());
  return {
    header: json(header),
    claims: json(claims),
    signed: `${header}.${claims}`,
    signature: Buffer.from(signature, 'base64url'),
  };
};

describe('weatherKitCredential', () => {
  it('signs a token WeatherKit would accept', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = weatherKitCredential(env())?.token() as string;
    const { header, claims, signed, signature } = parts(token);

    expect(header).toEqual({
      alg: 'ES256',
      kid: 'FGHIJ67890',
      // Apple's own arrangement: the team and the service, joined by a dot.
      id: 'ABCDE12345.com.example.weather',
    });
    // Apple rejects a token carrying anything beyond these four.
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'iss', 'sub']);
    expect(claims.iss).toBe('ABCDE12345');
    expect(claims.sub).toBe('com.example.weather');
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.exp).toBe(claims.iat + 3600);

    // The signature has to be the raw r‖s pair rather than Node's default DER
    // wrapping, which is the one mistake Apple answers 401 to and the one a
    // unit test can actually catch.
    expect(signature).toHaveLength(64);
    expect(
      verify(
        'sha256',
        Buffer.from(signed),
        {
          key: publicKey,
          dsaEncoding: 'ieee-p1363',
        },
        signature,
      ),
    ).toBe(true);
  });

  it('reuses one token rather than signing per request', () => {
    const credential = weatherKitCredential(env());

    expect(credential?.token()).toBe(credential?.token());
  });

  it('takes the key as PEM text as well as base64', () => {
    const credential = weatherKitCredential(
      env({ WEATHERKIT_PRIVATE_KEY: pem }),
    );

    expect(parts(credential?.token() as string).header.alg).toBe('ES256');
  });

  it('is simply absent when nothing is configured', () => {
    expect(weatherKitCredential({})).toBeUndefined();
  });

  it('refuses a half-configured deployment rather than going quiet', () => {
    // Three of four is a mistake, not an opt-out, and it should be loud while
    // someone is still watching the boot logs.
    expect(() =>
      weatherKitCredential(env({ WEATHERKIT_KEY_ID: undefined })),
    ).toThrow('half-configured');
  });

  it('refuses a key it cannot read', () => {
    expect(() =>
      weatherKitCredential(env({ WEATHERKIT_PRIVATE_KEY: 'not-a-key' })),
    ).toThrow('not a readable P-256 private key');
  });
});
