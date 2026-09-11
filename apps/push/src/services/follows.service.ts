import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { Model } from 'mongoose';
import { firstValueFrom, timeout } from 'rxjs';
import {
  FollowPayload,
  FollowResponse,
  RefreshFollowPayload,
  SERVICE_TOKENS,
  UnfollowPayload,
  ZARAGOZA_PATTERNS,
} from '@canopus/shared';
import { Follow, FollowDocument } from '../schemas/follow.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../schemas/subscription.schema';
import { Departure, identify, instant, matching } from './tracking';

/**
 * How long a bus is watched at the outside.
 *
 * An hour is longer than any wait this app is for. It is not the normal end —
 * that is the bus arriving — it is the backstop that makes a crash cost
 * nothing: the rows clean themselves up whether or not this service ever runs
 * again.
 */
const LIFETIME = 60 * 60 * 1000;

/**
 * How long after that Mongo is allowed to take the row.
 *
 * The TTL index used to fire at the same instant the sweep was watching for,
 * and the two raced: a row Mongo won ended without the phone being told,
 * leaving a countdown on a Lock Screen with nothing behind it. Five minutes
 * hands the service the first go and leaves the index as what it was meant to
 * be — the thing that cleans up after a crash.
 */
const GRACE = 5 * 60 * 1000;

/** What one stop's board looks like coming back from the transit service. */
interface StationResponse {
  times?: Departure[];
  /**
   * Which road it came down: `api` is the operator's own feed, `web` is their
   * departure board scraped. They do not move at the same rate, which is what
   * decides how often this service asks again — see `ArrivalsService`.
   */
  source?: string;
}

/**
 * Which pattern reads which kind of stop.
 *
 * Written out rather than decided with a ternary, so a kind nobody has taught
 * this service about is refused rather than quietly read as a bus. A new means
 * of transport is a line here and a case in `MarkerKind` on the app's side —
 * everything between the two is already told which kind it is holding.
 */
const BOARDS: Record<string, string> = {
  bus: ZARAGOZA_PATTERNS.busStation,
  tram: ZARAGOZA_PATTERNS.tramStation,
};

/** A stop's departures and where they were read from. */
export interface Board {
  times: Departure[];
  source?: string;
}

/**
 * How near an existing subscription's instant a new follower has to be for it
 * to be the same bus.
 *
 * Ninety seconds. Two people tapping the same departure a minute apart read
 * boards that disagree slightly — one saw `4 min.`, the other `3 min.` — and
 * they are waiting for one bus, which should be watched once. Wider than this
 * and a line running every two minutes starts pooling two departures into one.
 */
const SAME_BUS = 90_000;

@Injectable()
export class FollowsService {
  private readonly logger = new Logger(FollowsService.name);

  constructor(
    @InjectModel(Follow.name) private readonly follows: Model<FollowDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptions: Model<SubscriptionDocument>,
    @Inject(SERVICE_TOKENS.zaragoza) private readonly zaragoza: ClientProxy,
  ) {}

  /**
   * Take a departure on, for this phone.
   *
   * Two rows, and which of them is made depends on whether anybody is already
   * waiting for this bus. The subscription is the bus — read once, decided
   * once, told to everybody — and the follow is this phone's place behind it.
   * Somebody tapping a departure another reader already follows costs no board
   * request at all.
   *
   * Which departure is the caller's to say: the operator publishes two of each
   * line, a reader at the pole watching the first pull out is waiting for the
   * second, and nothing in a board read at this end can tell those apart. So
   * the app sends the instant its row was due and this finds that bus on its
   * own reading — the same rule the poller uses from then on.
   */
  async create(payload: FollowPayload): Promise<FollowResponse | null> {
    const now = new Date();

    // Already watched? Then this is one more phone behind a bus this service
    // is reading every half minute anyway.
    let subscription = payload.anchor
      ? await this.watching(payload, new Date(payload.anchor * 1000))
      : null;

    if (!subscription) {
      const { times: board } = await this.board(payload.kind, payload.stopId);
      const matches = matching(board, payload.line, payload.destination);
      if (!matches.length) return null;

      const picked = payload.anchor
        ? identify(
            board,
            {
              line: payload.line,
              destination: payload.destination,
              anchor: new Date(payload.anchor * 1000),
              taken: now,
            },
            now,
          )
        : null;
      // An anchor that matches nothing is a bus that went in the seconds since
      // the app read the board. Refused rather than quietly followed on the
      // soonest row: this end would then be pushing a countdown for a bus
      // nobody asked about, and the app keeps its own.
      if (payload.anchor && !picked) return null;

      subscription = await this.subscriptions.create({
        kind: payload.kind,
        stopId: payload.stopId,
        stopKey: payload.stopKey,
        stopName: payload.stopName,
        line: payload.line,
        destination: payload.destination,
        anchor: picked?.arrival ?? instant(matches[0].time, now),
        words: picked?.words ?? matches[0].time,
        nextWords: picked?.nextWords,
        position: picked?.position,
        taken: now,
        endsAt: new Date(now.getTime() + LIFETIME),
        expiresAt: new Date(now.getTime() + LIFETIME + GRACE),
      });
    }

    // One departure per phone, like the Lock Screen it draws on: a second
    // follow from the same device replaces the first rather than joining it.
    await this.unfollowToken(payload.token);
    const follow = await this.follows.create({
      subscription: subscription.id,
      app: payload.app,
      platform: payload.platform,
      token: payload.token,
      activityToken: payload.activityToken,
      locale: payload.locale,
    });
    return {
      id: follow.id as string,
      expiresAt: subscription.endsAt.toISOString(),
    };
  }

  /**
   * The bus somebody is asking to follow, where this service already watches it.
   *
   * Matched on when it is due rather than on anything the operator calls it,
   * because they call it nothing — and within a minute and a half, because two
   * people tapping one departure a minute apart read boards that disagree
   * slightly and are still waiting for one bus.
   */
  private async watching(
    payload: FollowPayload,
    anchor: Date,
  ): Promise<SubscriptionDocument | null> {
    const near = await this.subscriptions
      .find({
        stopId: payload.stopId,
        kind: payload.kind,
        line: payload.line,
        destination: payload.destination,
        endsAt: { $gt: new Date() },
      })
      .exec();
    return (
      near.find(
        (one) => Math.abs(one.anchor.getTime() - anchor.getTime()) <= SAME_BUS,
      ) ?? null
    );
  }

  /** A new activity token for a banner already being pushed to. */
  async refresh(
    payload: RefreshFollowPayload,
  ): Promise<{ refreshed: boolean }> {
    const result = await this.follows.updateOne(
      { _id: payload.id },
      { $set: { activityToken: payload.activityToken } },
    );
    return { refreshed: result.matchedCount > 0 };
  }

  /**
   * One reader stops following.
   *
   * The bus goes on being watched while somebody else is waiting for it, and
   * stops being watched the moment nobody is: a subscription with no followers
   * is a board request nobody asked for.
   */
  async remove(payload: UnfollowPayload): Promise<{ removed: boolean }> {
    const follow = await this.follows.findById(payload.id).exec();
    if (!follow) return { removed: false };
    await follow.deleteOne();
    await this.prune(follow.subscription.toString());
    return { removed: true };
  }

  /** Everything this device was having watched for it. */
  async removeForToken(token: string): Promise<number> {
    return this.unfollowToken(token);
  }

  private async unfollowToken(token: string): Promise<number> {
    const going = await this.follows.find({ token }).exec();
    if (!going.length) return 0;
    await this.follows.deleteMany({ token });
    for (const follow of going) {
      await this.prune(follow.subscription.toString());
    }
    return going.length;
  }

  /** A bus nobody is waiting for any more is a bus nobody reads for. */
  private async prune(subscription: string): Promise<void> {
    const left = await this.follows.countDocuments({ subscription });
    if (left === 0) await this.subscriptions.deleteOne({ _id: subscription });
  }

  /** One follow, by the id the app was handed. */
  byId(id: string): Promise<FollowDocument | null> {
    return this.follows.findById(id).exec();
  }

  /** The bus a follow is waiting for. */
  subscriptionOf(follow: FollowDocument): Promise<SubscriptionDocument | null> {
    return this.subscriptions.findById(follow.subscription).exec();
  }

  /** Every phone waiting for this bus. */
  followersOf(subscription: SubscriptionDocument): Promise<FollowDocument[]> {
    return this.follows.find({ subscription: subscription.id }).exec();
  }

  /** Every bus still worth reading a board for. */
  live(): Promise<SubscriptionDocument[]> {
    return this.subscriptions.find({ endsAt: { $gt: new Date() } }).exec();
  }

  /**
   * The ones whose hour is up.
   *
   * Ended out loud rather than left to the TTL index: a row that simply
   * vanishes leaves a countdown on somebody's phone with nothing behind it.
   */
  expired(): Promise<SubscriptionDocument[]> {
    return this.subscriptions.find({ endsAt: { $lte: new Date() } }).exec();
  }

  /** The bus and everybody waiting for it, gone together. */
  async close(subscription: SubscriptionDocument): Promise<void> {
    await this.follows.deleteMany({ subscription: subscription.id });
    await subscription.deleteOne();
  }

  /** Which bus on this board is the one this subscription is watching. */
  reading(subscription: SubscriptionDocument, board: Departure[], now: Date) {
    return identify(
      board,
      {
        line: subscription.line,
        destination: subscription.destination,
        anchor: subscription.anchor,
        taken: subscription.taken,
        position: subscription.position,
      },
      now,
    );
  }

  /**
   * One stop's next departures, from the service that owns them.
   *
   * Read through that service's own ten-second cache, which is the point: a
   * hundred people waiting at Plaza España cost the operator one request, and
   * the reading they share is the same one the app's own sheet would get.
   */
  async board(kind: string, stopId: string): Promise<Board> {
    const pattern = BOARDS[kind];
    // A kind this service has no board for. Today that is a bike dock or a
    // cinema, neither of which has a departure to follow; tomorrow it is
    // whatever the city adds next, and the old spelling of this — anything
    // that is not a tram is a bus — would have answered a question about
    // trains with a list of buses and told nobody.
    if (!pattern) {
      this.logger.warn(`Nothing to read for a ${kind} stop; not following it.`);
      return { times: [] };
    }
    try {
      const station = await firstValueFrom(
        this.zaragoza
          .send<StationResponse>(pattern, { id: stopId })
          .pipe(timeout(8000)),
      );
      return { times: station?.times ?? [], source: station?.source };
    } catch (error) {
      this.logger.warn(
        `No board for ${kind}:${stopId}: ${(error as Error).message}`,
      );
      // An empty board is not "the bus has gone" — see the poller, which
      // treats a failed read as a reason to say nothing at all.
      return { times: [] };
    }
  }
}
