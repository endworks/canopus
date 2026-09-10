import { connect, ClientHttp2Session, constants } from 'node:http2';
import { createPrivateKey, KeyObject, sign } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * Apple's push service, spoken to directly.
 *
 * Directly, and not through Firebase, because of one thing: a Live Activity is
 * updated by a push whose `apns-push-type` is `liveactivity`, and FCM will not
 * send that header. Since the connection has to exist for the countdown, it
 * carries the ordinary notifications too and iOS needs no second SDK.
 *
 * The credential is Apple's token auth: an ES256 JWT signed with a `.p8`,
 * good for an hour, minted the way `WeatherKitCredential` mints its own. A
 * deployment with no key configured is not an error — the service starts, says
 * so once, and every send is a no-op, so a machine without secrets still runs.
 */
@Injectable()
export class ApnsService implements OnModuleDestroy {
  private readonly logger = new Logger(ApnsService.name);
  private session?: ClientHttp2Session;
  private token?: { value: string; minted: number };
  private readonly key?: KeyObject;

  // Fields and not constructor parameters, the way FcmService and ClientKeys
  // read theirs. A defaulted parameter property is still a parameter: tsc
  // writes `design:paramtypes` for it, an inferred type lands there as
  // `Object`, and the injector goes looking for a provider registered under
  // `Object` rather than seeing a default it should leave alone. Nest 11 let
  // that pass and Nest 12 does not — it refuses to construct the service, and
  // since nothing catches that, the whole process exits at boot.
  private readonly teamId = process.env.APNS_TEAM_ID ?? '';
  private readonly keyId = process.env.APNS_KEY_ID ?? '';
  private readonly bundleId = process.env.APNS_BUNDLE_ID ?? '';
  private readonly host =
    process.env.APNS_ENVIRONMENT === 'sandbox'
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com';

  constructor() {
    const raw = process.env.APNS_PRIVATE_KEY;
    if (!raw || !this.teamId || !this.keyId || !this.bundleId) {
      this.logger.warn(
        'No APNs credential configured: nothing will be pushed to iOS.',
      );
      return;
    }
    // A `.p8` is a PEM block, and its newlines do not survive a secret store,
    // a CI environment and an SSH hop intact — so base64 is the form that
    // travels, with a raw PEM accepted for anyone running it by hand.
    this.key = createPrivateKey(
      raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString(),
    );
  }

  get configured(): boolean {
    return this.key !== undefined;
  }

  /**
   * Send one push.
   *
   * Answers what should happen to the token rather than throwing: `gone` is
   * Apple saying this device or activity no longer exists, which is a row to
   * delete and not an incident. Everything else that fails is logged and
   * shrugged off — a push that did not arrive is a countdown that stays as it
   * was, which is the failure this whole design is built to survive.
   */
  async send(
    token: string,
    payload: unknown,
    options: {
      pushType: 'liveactivity' | 'alert' | 'background';
      /** Live Activity pushes go to a topic of their own. */
      topicSuffix?: string;
      priority?: 5 | 10;
      /** Seconds since the epoch after which Apple stops trying. */
      expiration?: number;
      collapseId?: string;
    },
  ): Promise<'sent' | 'gone' | 'failed'> {
    if (!this.key) return 'failed';
    const body = Buffer.from(JSON.stringify(payload));
    const headers: Record<string, string | number> = {
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
      [constants.HTTP2_HEADER_AUTHORIZATION]: `bearer ${this.bearer()}`,
      'apns-topic': this.bundleId + (options.topicSuffix ?? ''),
      'apns-push-type': options.pushType,
      'apns-priority': options.priority ?? 10,
      [constants.HTTP2_HEADER_CONTENT_LENGTH]: body.length,
    };
    if (options.expiration !== undefined) {
      headers['apns-expiration'] = options.expiration;
    }
    if (options.collapseId) headers['apns-collapse-id'] = options.collapseId;

    try {
      const { status, reason } = await this.request(headers, body);
      if (status === 200) return 'sent';
      // 410 is a device that has uninstalled; 400 BadDeviceToken and its
      // relatives are a token that was never good. Both mean stop writing to
      // this row rather than try again on the next sweep.
      if (
        status === 410 ||
        reason === 'BadDeviceToken' ||
        reason === 'Unregistered'
      ) {
        return 'gone';
      }
      this.logger.warn(`APNs refused a push: ${status} ${reason ?? ''}`.trim());
      return 'failed';
    } catch (error) {
      this.logger.warn(`APNs unreachable: ${(error as Error).message}`);
      // A broken session is not reused: the next send dials again.
      this.session?.destroy();
      this.session = undefined;
      return 'failed';
    }
  }

  private request(
    headers: Record<string, string | number>,
    body: Buffer,
  ): Promise<{ status: number; reason?: string }> {
    const session = this.connection();
    return new Promise((resolve, reject) => {
      const stream = session.request(headers);
      let status = 0;
      let text = '';
      stream.setTimeout(10_000, () => stream.destroy(new Error('timed out')));
      stream.on('response', (received) => {
        status = Number(received[constants.HTTP2_HEADER_STATUS] ?? 0);
      });
      stream.on('data', (chunk: Buffer) => (text += chunk.toString()));
      stream.on('error', reject);
      stream.on('end', () => {
        let reason: string | undefined;
        try {
          reason = text
            ? (JSON.parse(text) as { reason?: string }).reason
            : undefined;
        } catch {
          reason = undefined;
        }
        resolve({ status, reason });
      });
      stream.end(body);
    });
  }

  /**
   * One HTTP/2 session, kept open.
   *
   * Apple asks for exactly this — a connection per provider, reused — and the
   * poller's shape makes it matter: a busy minute is one stop's followers all
   * being written to at once, and a TLS handshake each would be the expensive
   * part of the whole service.
   */
  private connection(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return this.session;
    }
    this.session = connect(this.host);
    this.session.on('error', (error) =>
      this.logger.warn(`APNs session error: ${error.message}`),
    );
    return this.session;
  }

  /**
   * The developer token, minted on first use and replaced before it is out.
   *
   * Apple rejects a token minted more than once every twenty minutes and
   * refuses one older than an hour, so it is held for fifty minutes: inside
   * both, and far enough from either to survive a slow clock.
   */
  private bearer(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && now - this.token.minted < 50 * 60)
      return this.token.value;

    const base64url = (value: Buffer | string) =>
      Buffer.from(value).toString('base64url');
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: this.keyId }));
    const claims = base64url(JSON.stringify({ iss: this.teamId, iat: now }));
    const signature = sign(null, Buffer.from(`${header}.${claims}`), {
      key: this.key!,
      dsaEncoding: 'ieee-p1363',
    });
    const value = `${header}.${claims}.${base64url(signature)}`;
    this.token = { value, minted: now };
    return value;
  }

  onModuleDestroy() {
    this.session?.close();
  }
}
