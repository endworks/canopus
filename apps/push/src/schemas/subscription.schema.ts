import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * One bus, at one stop, being watched.
 *
 * The thing this service actually does, made a row of its own. Everybody
 * waiting at the same pole for the same departure is waiting for one bus, and
 * it is read once: one board request, one identification, one decision about
 * whether anything has changed, and then that answer is told to every phone
 * following it. A hundred people at Plaza España cost what one costs.
 *
 * It used to be implicit. Each device carried its own copy of the anchor, the
 * words and the minutes last shown, and the sweep grouped them back together
 * every time it ran — so two phones that started a few seconds apart could
 * cross a minute boundary on different sweeps and show different numbers for
 * one bus. The grouping is the fact; this is it written down.
 *
 * It lives as long as the bus does. When the board stops listing it, or it
 * reaches the stop, or the hour runs out, the followers are told and both the
 * subscription and every follow of it go together.
 */
// Named for what it holds and nothing else: the database is `push`, so a
// `push_` on every collection in it was the service's name said twice.
@Schema({ timestamps: true, collection: 'subscriptions' })
export class Subscription {
  /** `bus` or `tram`, and the stop as the operator's feed knows it. */
  @Prop({ required: true })
  kind: string;

  @Prop({ required: true, index: true })
  stopId: string;

  /** The pin's key, `bus:720`, for the client to route a tap by. */
  @Prop({ required: true })
  stopKey: string;

  @Prop({ required: true })
  stopName: string;

  @Prop({ required: true })
  line: string;

  @Prop({ required: true })
  destination: string;

  /**
   * The line's colour as the app spells one, or absent where the operator
   * publishes none.
   *
   * Read once when the watch opens rather than on every push: a line's colour
   * is the one thing about a departure that cannot change while somebody waits
   * for it. It is here because a banner this service raises has to carry the
   * attributes the app would have written itself, and the app resolves this
   * from a line listing half a megabyte long that an extension has no room to
   * open — so if it does not travel, the banner is drawn in the fallback red
   * and every line looks like every other.
   */
  @Prop()
  lineArgb?: number;

  /**
   * When this bus is due, as last read.
   *
   * What identifies it. The operator publishes two of each line and gives
   * neither a name, so the instant is the only thing that tells the one
   * somebody is waiting for from the one in front of it — see `identify`.
   */
  @Prop({ required: true })
  anchor: Date;

  /** The operator's own words for that wait, as last pushed. */
  @Prop({ required: true })
  words: string;

  /** The words for the one behind it, as last pushed. */
  @Prop()
  nextWords?: string;

  /** The minutes the followers were last told, as they read them. */
  @Prop()
  shown?: number;

  /** Where it sat in its line's list, as a tiebreak when two are seconds apart. */
  @Prop()
  position?: number;

  /** Whether the last thing said was that it is pulling in. */
  @Prop({ default: false })
  arriving?: boolean;

  /** When that reading was taken. */
  @Prop({ required: true })
  taken: Date;

  /** How many times an ending has been attempted and not landed. */
  @Prop({ default: 0 })
  attempts?: number;

  /**
   * How many readings in a row have not found this bus on its board.
   *
   * These boards drop a row for one refresh and put it back — an operator
   * re-estimating, a scrape that came down mid-write — and a row missing once
   * is not a bus that has gone. It was treated as one: a single miss ended the
   * watch, rang `gone` at everybody waiting, and left a reader looking at
   * "Ha salido" while the board in the app beside it said the bus was a minute
   * away.
   *
   * Reset by the next reading that finds it, so only a real disappearance —
   * several in a row — is believed.
   */
  @Prop({ default: 0 })
  missed?: number;

  /** When this service stops watching, whatever else happens. */
  @Prop({ required: true })
  endsAt: Date;

  /** When Mongo drops the row — later than `endsAt`, so the sweep goes first. */
  @Prop({ required: true })
  expiresAt: Date;
}

export type SubscriptionDocument = HydratedDocument<Subscription>;
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// The backstop, five minutes after this service should have ended it itself.
SubscriptionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// The sweep's own read: everything still being watched, grouped by its stop.
SubscriptionSchema.index({ stopId: 1, kind: 1 });
// And the one `create` asks: is this bus already being watched for somebody?
SubscriptionSchema.index({ stopId: 1, line: 1, destination: 1 });
