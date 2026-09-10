import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ForgetDevicePayload,
  FollowPayload,
  PUSH_PATTERNS,
  RefreshFollowPayload,
  RegisterDevicePayload,
  SetPreferencesPayload,
  UnfollowPayload,
} from '@canopus/shared';
import { ClientKeys } from './services/client-keys';
import { DevicesService } from './services/devices.service';
import { FollowsService } from './services/follows.service';

/**
 * What the gateway forwards, with the credential the caller sent.
 *
 * The key travels in the payload rather than being checked at the edge, so the
 * secret stays in the service that needs it and the gateway holds none — the
 * arrangement `weather` already uses for the same reason.
 */
type Authorised<T> = T & { clientKey?: string };

@Controller()
export class PushController {
  constructor(
    private readonly keys: ClientKeys,
    private readonly devices: DevicesService,
    private readonly follows: FollowsService,
  ) {}

  @MessagePattern(PUSH_PATTERNS.registerDevice)
  registerDevice(@Payload() payload: Authorised<RegisterDevicePayload>) {
    this.keys.assertClient(payload.clientKey);
    return this.devices.register(payload);
  }

  @MessagePattern(PUSH_PATTERNS.setPreferences)
  setPreferences(@Payload() payload: Authorised<SetPreferencesPayload>) {
    this.keys.assertClient(payload.clientKey);
    return this.devices.setPreferences(payload);
  }

  @MessagePattern(PUSH_PATTERNS.forgetDevice)
  forgetDevice(@Payload() payload: Authorised<ForgetDevicePayload>) {
    this.keys.assertClient(payload.clientKey);
    return this.devices.forget(payload);
  }

  @MessagePattern(PUSH_PATTERNS.follow)
  follow(@Payload() payload: Authorised<FollowPayload>) {
    this.keys.assertClient(payload.clientKey);
    return this.follows.create(payload);
  }

  @MessagePattern(PUSH_PATTERNS.refreshFollow)
  refreshFollow(@Payload() payload: Authorised<RefreshFollowPayload>) {
    this.keys.assertClient(payload.clientKey);
    return this.follows.refresh(payload);
  }

  @MessagePattern(PUSH_PATTERNS.unfollow)
  unfollow(@Payload() payload: Authorised<UnfollowPayload>) {
    this.keys.assertClient(payload.clientKey);
    return this.follows.remove(payload);
  }
}
