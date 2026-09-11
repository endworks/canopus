import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PushPlatform } from '@canopus/shared';

/**
 * One phone waiting for one bus.
 *
 * Everything about the bus — when it is due, what the operator called it, what
 * is behind it — belongs to the `Subscription` this points at, because it is
 * the same for everybody waiting. What is left here is what differs between
 * two people at one pole: which phone, which banner on it, which language, and
 * whether this one has already been rung at.
 *
 * That split is the whole point. A hundred followers of one departure are one
 * board request and one decision, and what they are told is identical by
 * construction rather than by two anchors happening to agree.
 */
@Schema({ timestamps: true, collection: 'follows' })
export class Follow {
  /** The bus this phone is waiting for. */
  @Prop({ required: true, index: true })
  subscription: Types.ObjectId;

  /** One service, several apps: this is which one is speaking. */
  @Prop({ required: true, index: true })
  app: string;

  @Prop({ required: true })
  platform: PushPlatform;

  /** The device's own token, so a dead device takes its follows with it. */
  @Prop({ required: true, index: true })
  token: string;

  /**
   * The Live Activity's push token. Addressed at the banner rather than the
   * phone, and rotated by ActivityKit while it runs — see `refreshFollow`.
   */
  @Prop()
  activityToken?: string;

  /** The words this phone wants, which is the app's language and not the OS's. */
  @Prop()
  locale?: string;

  /**
   * Whether the minute-before nudge has already rung here.
   *
   * The one decision that stays personal. Everything else about this bus is
   * decided once for everybody; a phone that has already been rung must not
   * ring again because somebody else joined the same wait a minute later.
   */
  @Prop({ default: false })
  alerted: boolean;

  /** How many times an ending has been attempted at this phone and not landed. */
  @Prop({ default: 0 })
  attempts?: number;
}

export type FollowDocument = HydratedDocument<Follow>;
export const FollowSchema = SchemaFactory.createForClass(Follow);

// One phone follows one departure at a time, like the Lock Screen it draws on.
FollowSchema.index({ token: 1 }, { unique: true });
