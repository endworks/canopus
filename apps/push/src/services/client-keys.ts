import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

/**
 * Who may talk to this service.
 *
 * Two credentials that are not the same thing. The client key is shipped
 * inside every copy of the app, so it is a gate and not an identity: it says
 * "one of ours", and the worst somebody who extracts it can do is address
 * tokens they already hold. The admin key sends a message to everybody who has
 * opted in, and is server-to-server only — it must never be in a binary.
 *
 * The endpoints these guard are absent from the published API document. That
 * is tidiness, not security: a route nobody has written down is still a route,
 * and this is what actually stands in front of it.
 *
 * Comma-separate to rotate: every listed key is accepted, so a new one goes in
 * front, the apps ship, and the old one comes out when the old build is gone.
 */
@Injectable()
export class ClientKeys {
  private readonly logger = new Logger(ClientKeys.name);
  private readonly client: Buffer[];
  private readonly admin: Buffer[];

  constructor() {
    this.client = ClientKeys.digest(process.env.PUSH_CLIENT_KEYS);
    this.admin = ClientKeys.digest(process.env.PUSH_ADMIN_KEY);
    if (!this.client.length) {
      this.logger.warn(
        'No PUSH_CLIENT_KEYS configured: every registration will be refused.',
      );
    }
  }

  private static digest(value?: string): Buffer[] {
    return (value ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => createHash('sha256').update(key).digest());
  }

  /**
   * Compared without leaking how nearly it matched: hashed first so both
   * buffers are the same width whatever was sent, and every key checked even
   * after one matches, so the time says nothing about which.
   */
  private static allows(known: Buffer[], candidate?: string): boolean {
    const key = candidate?.trim();
    if (!key || !known.length) return false;
    const digest = createHash('sha256').update(key).digest();
    return known.reduce(
      (matched, one) => timingSafeEqual(one, digest) || matched,
      false,
    );
  }

  /** What a device must send to register itself or follow a departure. */
  assertClient(key?: string): void {
    if (!ClientKeys.allows(this.client, key)) {
      throw new UnauthorizedException('Unknown client');
    }
  }

  /** What sending a promotion to everybody takes. */
  assertAdmin(key?: string): void {
    if (!ClientKeys.allows(this.admin, key)) {
      throw new UnauthorizedException('Unknown client');
    }
  }
}
