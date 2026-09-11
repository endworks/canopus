import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { PushCategory, PushPlatform } from '@canopus/shared';

/**
 * One install of one app, and what it has agreed to be told.
 *
 * The row is the address, not the person: a token, which store it came from,
 * and three switches. Nothing here says who the reader is, and nothing here is
 * asked of them beyond the switches — a device that stops answering is a token
 * Apple or Google reports as gone, and the row goes with it.
 *
 * `app` is on every row because this service is meant to outlive the one that
 * needed it first. A second app is a second bundle id and a second credential
 * in the environment; it is not a second copy of this.
 */
@Schema({ timestamps: true, collection: 'devices' })
export class Device {
  @Prop({ required: true, index: true })
  app: string;

  @Prop({ required: true })
  platform: PushPlatform;

  /** APNs device token on iOS, FCM registration token on Android. */
  @Prop({ required: true, unique: true })
  token: string;

  @Prop()
  locale?: string;

  /**
   * ActivityKit's push-to-start token: the one thing that can put a countdown
   * on a Lock Screen without the app being opened first. iOS only, and only on
   * versions that mint one.
   */
  @Prop()
  pushToStartToken?: string;

  /**
   * What this device has said it wants.
   *
   * `arrivals` alone by default, and that is not a marketing decision: a
   * reader who follows a departure has asked for that departure and nothing
   * else. The other two are opt-in and stay off until somebody moves a switch.
   */
  @Prop({ type: [String], default: ['arrivals'] })
  categories: PushCategory[];

  /**
   * When each category was last agreed to, and to what wording.
   *
   * Kept because for the two that are marketing this is the thing that has to
   * be producible later: not "they are subscribed" but "they said yes, then,
   * to that sentence". A map rather than a field per category, so a fourth
   * kind of message needs no migration.
   */
  @Prop({ type: Object, default: {} })
  consent: Record<string, { at: Date; wording: string }>;

  /**
   * Set when the platform tells us the token is dead — a 410 from APNs, an
   * `UNREGISTERED` from FCM. Kept rather than deleted for a day so a device
   * that re-registers is recognised rather than counted twice.
   */
  @Prop()
  retiredAt?: Date;
}

export type DeviceDocument = HydratedDocument<Device>;
export const DeviceSchema = SchemaFactory.createForClass(Device);

// A day after the platform called it dead, and then it goes. The comment on
// `retiredAt` has always said "kept for a day"; nothing made that true, so a
// registry that only ever grew was holding every token any phone has ever
// retired. A device that comes back inside the day is recognised — `register`
// clears the mark — and one that does not was never coming back.
DeviceSchema.index({ retiredAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });
