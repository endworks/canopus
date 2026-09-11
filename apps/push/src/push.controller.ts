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
import { ArrivalsService } from './services/arrivals.service';

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
    private readonly arrivals: ArrivalsService,
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
  async forgetDevice(@Payload() payload: Authorised<ForgetDevicePayload>) {
    this.keys.assertClient(payload.clientKey);
    // What it was having watched goes with it. Otherwise this service would
    // read a stop every half a minute for the rest of the hour, to push a
    // countdown at a phone that has just asked to be forgotten.
    await this.follows.removeForToken(payload.token);
    return this.devices.forget(payload);
  }

  @MessagePattern(PUSH_PATTERNS.follow)
  async follow(@Payload() payload: Authorised<FollowPayload>) {
    this.keys.assertClient(payload.clientKey);
    const taken = await this.follows.create(payload);
    // The first reading goes out before this answers, so the countdown is on
    // the phone by the time the app has finished asking for it — and so the
    // app knows the road works and can stop reading the board itself. See
    // `ArrivalsService.announce`.
    if (taken) await this.arrivals.announce(taken.id);
    return taken;
  }

  @MessagePattern(PUSH_PATTERNS.refreshFollow)
  refreshFollow(@Payload() payload: Authorised<RefreshFollowPayload>) {
    this.keys.assertClient(payload.clientKey);
    return this.follows.refresh(payload);
  }

  @MessagePattern(PUSH_PATTERNS.announceFollow)
  async announceFollow(@Payload() payload: Authorised<{ id: string }>) {
    this.keys.assertClient(payload.clientKey);
    await this.arrivals.announce(payload.id);
    return { announced: true };
  }

  @MessagePattern(PUSH_PATTERNS.unfollow)
  unfollow(@Payload() payload: Authorised<UnfollowPayload>) {
    this.keys.assertClient(payload.clientKey);
    return this.follows.remove(payload);
  }
}
