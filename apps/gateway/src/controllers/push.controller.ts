import {
  Body,
  Controller,
  Delete,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  ForgetDevicePayload,
  FollowPayload,
  RegisterDevicePayload,
  SetPreferencesPayload,
} from '@canopus/shared';
import { PushService } from '../services/push.service';

/** The header a device sends to prove it is one of ours. */
const CLIENT_KEY = 'x-push-client-key';

/**
 * Registering a device, and following a departure.
 *
 * Absent from the published API document, which every other controller here is
 * in. Not because it is secret — a route nobody wrote down is still a route,
 * and the key checked inside the push service is what actually stands in front
 * of these — but because the document describes a public transit API that
 * anybody may call, and these six are the private conversation between this
 * deployment and its own apps. Listing them would invite exactly the calls
 * they are built to refuse.
 *
 * The other reason is quieter: everything in that document is a question about
 * the city. These are the only endpoints that take something belonging to a
 * person — a push token, which addresses their phone — and they are worth
 * keeping visibly apart from the rest for that alone.
 */
@ApiExcludeController()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('devices')
  registerDevice(
    @Body() body: RegisterDevicePayload,
    @Headers(CLIENT_KEY) clientKey?: string,
  ) {
    return this.push.registerDevice({ ...body, clientKey });
  }

  @Patch('devices/preferences')
  setPreferences(
    @Body() body: SetPreferencesPayload,
    @Headers(CLIENT_KEY) clientKey?: string,
  ) {
    return this.push.setPreferences({ ...body, clientKey });
  }

  @Post('devices/forget')
  forgetDevice(
    @Body() body: ForgetDevicePayload,
    @Headers(CLIENT_KEY) clientKey?: string,
  ) {
    return this.push.forgetDevice({ ...body, clientKey });
  }

  @Post('follows')
  follow(@Body() body: FollowPayload, @Headers(CLIENT_KEY) clientKey?: string) {
    return this.push.follow({ ...body, clientKey });
  }

  /** ActivityKit rotates an activity's token while it runs. */
  @Patch('follows/:id')
  refreshFollow(
    @Param('id') id: string,
    @Body() body: { activityToken: string },
    @Headers(CLIENT_KEY) clientKey?: string,
  ) {
    return this.push.refreshFollow({
      id,
      activityToken: body.activityToken,
      clientKey,
    });
  }

  @Delete('follows/:id')
  unfollow(@Param('id') id: string, @Headers(CLIENT_KEY) clientKey?: string) {
    return this.push.unfollow({ id, clientKey });
  }
}
