import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import {
  ForgetDevicePayload,
  FollowPayload,
  PUSH_PATTERNS,
  RefreshFollowPayload,
  RegisterDevicePayload,
  SERVICE_TOKENS,
  SetPreferencesPayload,
  UnfollowPayload,
} from '@canopus/shared';

/**
 * The push service, from the edge.
 *
 * Nothing is decided here. The caller's key rides along in the payload and is
 * checked at the other end, where the secret lives — the same arrangement the
 * weather endpoints use.
 */
@Injectable()
export class PushService {
  @Inject(SERVICE_TOKENS.push) private client: ClientProxy;

  registerDevice(payload: RegisterDevicePayload & { clientKey?: string }) {
    return lastValueFrom(
      this.client.send(PUSH_PATTERNS.registerDevice, payload),
    );
  }

  setPreferences(payload: SetPreferencesPayload & { clientKey?: string }) {
    return lastValueFrom(
      this.client.send(PUSH_PATTERNS.setPreferences, payload),
    );
  }

  forgetDevice(payload: ForgetDevicePayload & { clientKey?: string }) {
    return lastValueFrom(this.client.send(PUSH_PATTERNS.forgetDevice, payload));
  }

  follow(payload: FollowPayload & { clientKey?: string }) {
    return lastValueFrom(this.client.send(PUSH_PATTERNS.follow, payload));
  }

  refreshFollow(payload: RefreshFollowPayload & { clientKey?: string }) {
    return lastValueFrom(
      this.client.send(PUSH_PATTERNS.refreshFollow, payload),
    );
  }

  announceFollow(payload: { id: string; clientKey?: string }) {
    return lastValueFrom(
      this.client.send(PUSH_PATTERNS.announceFollow, payload),
    );
  }

  unfollow(payload: UnfollowPayload & { clientKey?: string }) {
    return lastValueFrom(this.client.send(PUSH_PATTERNS.unfollow, payload));
  }
}
