import { createPrivateKey, KeyObject, sign } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Firebase Cloud Messaging, which is the only road to an Android phone.
 *
 * The credential is a service account: a JWT signed with its private key is
 * exchanged for an access token, and that token is what a send is made with.
 * Both are minted here rather than by the Firebase Admin SDK — that package
 * brings a Google Cloud stack with it, and what this needs is one signature
 * and one POST.
 *
 * Everything goes as a **data** message and nothing as a notification. A
 * notification message is drawn by Google's own SDK while the app is in the
 * background, which is exactly the wrong shape here: what Android has to do
 * with an arrival is update the ongoing notification it is already showing,
 * counting down, rather than stack a fresh banner every fifteen seconds. Data
 * means the app decides what to draw.
 *
 * A deployment with no credential is not an error: it says so once and every
 * send is a no-op.
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private readonly key?: KeyObject;
  private readonly clientEmail?: string;
  private readonly projectId?: string;
  private token?: { value: string; expires: number };

  constructor() {
    const raw = process.env.FCM_SERVICE_ACCOUNT;
    if (!raw) {
      this.logger.warn(
        'No FCM service account configured: nothing will be pushed to Android.',
      );
      return;
    }
    try {
      // Base64 of the whole JSON is the form that travels: it holds a PEM
      // block, and PEM newlines do not survive a secret store, a CI
      // environment and an SSH hop intact.
      const json = raw.trim().startsWith('{')
        ? raw
        : Buffer.from(raw, 'base64').toString();
      const account = JSON.parse(json) as {
        project_id: string;
        client_email: string;
        private_key: string;
      };
      this.projectId = account.project_id;
      this.clientEmail = account.client_email;
      this.key = createPrivateKey(account.private_key);
    } catch (error) {
      this.logger.error(
        `FCM service account unreadable: ${(error as Error).message}`,
      );
    }
  }

  get configured(): boolean {
    return this.key !== undefined;
  }

  /**
   * One data message.
   *
   * Answers what should happen to the token, the way the APNs client does:
   * `gone` is Google saying this install no longer exists, which is a row to
   * delete rather than something to log every fifteen seconds forever.
   *
   * The time to live is short on purpose — an arrival held in a queue and
   * delivered four minutes late is worse than one never sent at all.
   */
  async send(
    token: string,
    data: Record<string, string>,
    options: { ttlSeconds?: number; collapseKey?: string } = {},
  ): Promise<'sent' | 'gone' | 'failed'> {
    if (!this.key || !this.projectId) return 'failed';
    const access = await this.accessToken();
    if (!access) return 'failed';

    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${access}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              data,
              android: {
                // A countdown is worth waking a dozing phone for; that is what
                // this priority means and a wakeup is what it costs.
                priority: 'HIGH',
                ttl: `${options.ttlSeconds ?? 120}s`,
                ...(options.collapseKey
                  ? { collapse_key: options.collapseKey }
                  : {}),
              },
            },
          }),
        },
      );
      if (response.ok) return 'sent';
      const body = (await response.json().catch(() => ({}))) as {
        error?: { status?: string; message?: string };
      };
      const status = body.error?.status;
      if (
        response.status === 404 ||
        status === 'NOT_FOUND' ||
        status === 'UNREGISTERED'
      ) {
        return 'gone';
      }
      this.logger.warn(
        `FCM refused a push: ${response.status} ${status ?? ''} ${
          body.error?.message ?? ''
        }`.trim(),
      );
      return 'failed';
    } catch (error) {
      this.logger.warn(`FCM unreachable: ${(error as Error).message}`);
      return 'failed';
    }
  }

  /**
   * An access token for the messaging scope, held until it is nearly out.
   *
   * One signed assertion and one form post, which is all Google's own library
   * does here — and doing it in this file keeps the dependency list empty.
   */
  private async accessToken(): Promise<string | undefined> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expires - 60 > now) return this.token.value;
    if (!this.key || !this.clientEmail) return undefined;

    const base64url = (value: Buffer | string) =>
      Buffer.from(value).toString('base64url');
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: this.clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    );
    const signature = base64url(
      sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), this.key),
    );

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${header}.${claims}.${signature}`,
        }),
      });
      if (!response.ok) {
        this.logger.warn(`FCM token refused: ${response.status}`);
        return undefined;
      }
      const body = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };
      this.token = { value: body.access_token, expires: now + body.expires_in };
      return body.access_token;
    } catch (error) {
      this.logger.warn(`FCM token unreachable: ${(error as Error).message}`);
      return undefined;
    }
  }
}
