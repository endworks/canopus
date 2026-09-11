import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { PushPlatform } from '@canopus/shared';

/**
 * One departure somebody is standing at a pole waiting for.
 *
 * The shortest-lived thing this service holds, and the only one that costs it
 * anything: while a follow exists its stop is read every half a minute and
 * every change is pushed to the device that asked. It dies three ways — the
 * bus arrives and leaves, the reader stops following, or `expiresAt` passes
 * and Mongo removes it without anybody being asked to.
 *
 * `anchor` and `words` are the last thing said to the device. They are what
 * the next reading is compared against, so that a board which has not changed
 * costs one comparison rather than one push.
 */
@Schema({ timestamps: true, collection: 'push_follows' })
export class Follow {
  @Prop({ required: true, index: true })
  app: string;

  @Prop({ required: true })
  platform: PushPlatform;

  /** The device's own token, so a dead device takes its follows with it. */
  @Prop({ required: true, index: true })
  token: string;

  /**
   * The Live Activity's push token. Addressed at the activity rather than the
   * phone, and rotated by ActivityKit while it runs — see `refreshFollow`.
   */
  @Prop()
  activityToken?: string;

  @Prop({ required: true })
  kind: string;

  /** What the operator's feed is asked about, and what the client calls it. */
  @Prop({ required: true, index: true })
  stopId: string;

  @Prop({ required: true })
  stopKey: string;

  @Prop({ required: true })
  stopName: string;

  @Prop({ required: true })
  line: string;

  @Prop({ required: true })
  destination: string;

  @Prop()
  locale?: string;

  /** When the bus this is following is expected, as last pushed. */
  @Prop({ required: true })
  anchor: Date;

  /** The operator's own words for that wait, as last pushed. */
  @Prop({ required: true })
  words: string;

  /**
   * The words for the one behind it, as last pushed.
   *
   * Stored because `agrees` compares it, and a field nothing ever writes is a
   * comparison that can never match: without this the service disagreed with
   * itself on every reading and pushed the phone a fresh countdown every half
   * a minute, for the whole of the wait.
   */
  @Prop()
  nextWords?: string;

  /** When that reading was taken. */
  @Prop({ required: true })
  taken: Date;

  /**
   * The number of minutes the reader was last told, as they read it.
   *
   * Not derivable from `anchor`: the countdown on the phone ticks by itself,
   * so the number on the glass changes without anything being sent. This is
   * what was actually said, and a difference between it and what the board now
   * means is the definition of "the time changed" — which is when this service
   * speaks. See `ArrivalsService.answer`.
   */
  @Prop()
  shown?: number;

  /**
   * Where this bus sat in its line's list when last read.
   *
   * Only ever a tiebreak: two departures of one line minutes apart are told
   * apart by when they are due, and this is what settles the case where they
   * are seconds apart and that cannot. It moves down as the buses in front of
   * it leave — the second becomes the first — which is why it is stored rather
   * than assumed constant.
   */
  @Prop()
  position?: number;

  /**
   * How many times the last word has been attempted and not landed.
   *
   * Every other reading is followed by another half a minute later; the one
   * that says the bus arrived or went is the last, and a phone that misses it
   * keeps a countdown to a bus it is already standing on. So it is retried a
   * few times before the row is let go. See ENDINGS.
   */
  @Prop({ default: 0 })
  attempts?: number;

  /** Whether the minute-before nudge has already gone out. */
  @Prop({ default: false })
  alerted: boolean;

  /**
   * The far end of it. An hour is longer than any wait this app is for, and
   * the TTL index below is what makes a crash mid-journey cost nothing: the
   * rows clean themselves up whether or not this service ever runs again.
   */
  @Prop({ required: true })
  expiresAt: Date;
}

export type FollowDocument = HydratedDocument<Follow>;
export const FollowSchema = SchemaFactory.createForClass(Follow);

// Mongo removes the row the moment it is due; nothing sweeps.
FollowSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// The poller's own read: every live follow, grouped by the stop it watches.
FollowSchema.index({ stopId: 1, kind: 1 });
