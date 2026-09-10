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
import { Departure, identify, instant, matching } from './tracking';

/**
 * How long a follow may live at the outside.
 *
 * An hour is longer than any wait this app is for. It is not the normal end —
 * that is the bus arriving — it is the backstop that makes a crash cost
 * nothing: Mongo drops the row whether or not this service ever runs again.
 */
const LIFETIME = 60 * 60 * 1000;

/** What one stop's board looks like coming back from the transit service. */
interface StationResponse {
  times?: Departure[];
}

@Injectable()
export class FollowsService {
  private readonly logger = new Logger(FollowsService.name);

  constructor(
    @InjectModel(Follow.name) private readonly follows: Model<FollowDocument>,
    @Inject(SERVICE_TOKENS.zaragoza) private readonly zaragoza: ClientProxy,
  ) {}

  /**
   * Take on a departure.
   *
   * The board is read once here rather than trusted from the caller: the app
   * sends which departure it is following, and this end decides what that
   * means — which bus, when, and what is behind it. From this moment the phone
   * is told things rather than asking for them.
   *
   * Which departure, though, is the caller's to say. The operator publishes
   * two of each line, and a reader standing at the pole watching the first one
   * pull out is waiting for the second; nothing in a board read here can tell
   * which of the two they tapped. So the app sends the instant its row was due
   * and this finds that bus on its own reading — the same rule the poller uses
   * from then on. A caller that sends no anchor is followed on the soonest
   * row, which is what every build before this one did.
   */
  async create(payload: FollowPayload): Promise<FollowResponse | null> {
    const board = await this.board(payload.kind, payload.stopId);
    const matches = matching(board, payload.line, payload.destination);
    if (!matches.length) return null;

    const now = new Date();
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
    // An anchor that matches nothing is a bus that has already gone in the
    // seconds since the app read the board. Refused rather than quietly
    // followed on the soonest row: this end would then be pushing a countdown
    // for a bus nobody asked about, and the app keeps its own — which is what
    // a refusal here means, not an error anybody sees.
    if (payload.anchor && !picked) return null;
    const words = picked?.words ?? matches[0].time;
    const anchor = picked?.arrival ?? instant(matches[0].time, now);
    // One at a time per device, like the Lock Screen it draws on: a second
    // follow from the same phone replaces the first rather than joining it.
    await this.follows.deleteMany({ token: payload.token });
    const follow = await this.follows.create({
      app: payload.app,
      platform: payload.platform,
      token: payload.token,
      activityToken: payload.activityToken,
      kind: payload.kind,
      stopId: payload.stopId,
      stopKey: payload.stopKey,
      stopName: payload.stopName,
      line: payload.line,
      destination: payload.destination,
      locale: payload.locale,
      anchor,
      words,
      taken: now,
      expiresAt: new Date(now.getTime() + LIFETIME),
    });
    return {
      id: follow.id as string,
      expiresAt: follow.expiresAt.toISOString(),
    };
  }

  /**
   * A new activity token for a follow already running.
   *
   * ActivityKit rotates these while an activity lives, and a push to the old
   * one goes nowhere — so this is not an optimisation, it is what keeps a
   * countdown alive past its first few minutes.
   */
  async refresh(
    payload: RefreshFollowPayload,
  ): Promise<{ refreshed: boolean }> {
    const result = await this.follows.updateOne(
      { _id: payload.id },
      { $set: { activityToken: payload.activityToken } },
    );
    return { refreshed: result.matchedCount > 0 };
  }

  async remove(payload: UnfollowPayload): Promise<{ removed: boolean }> {
    const result = await this.follows.deleteOne({ _id: payload.id });
    return { removed: result.deletedCount > 0 };
  }

  /** Every follow still worth reading a board for. */
  live(): Promise<FollowDocument[]> {
    return this.follows.find({ expiresAt: { $gt: new Date() } }).exec();
  }

  /**
   * One stop's next departures, from the service that owns them.
   *
   * Read through that service's own ten-second cache, which is the point: a
   * hundred people waiting at Plaza España cost the operator one request, and
   * the reading they share is the same one the app's own sheet would get.
   */
  async board(kind: string, stopId: string): Promise<Departure[]> {
    const pattern =
      kind === 'tram'
        ? ZARAGOZA_PATTERNS.tramStation
        : ZARAGOZA_PATTERNS.busStation;
    try {
      const station = await firstValueFrom(
        this.zaragoza
          .send<StationResponse>(pattern, { id: stopId })
          .pipe(timeout(8000)),
      );
      return station?.times ?? [];
    } catch (error) {
      this.logger.warn(
        `No board for ${kind}:${stopId}: ${(error as Error).message}`,
      );
      // An empty board is not "the bus has gone" — see the poller, which
      // treats a failed read as a reason to say nothing at all.
      return [];
    }
  }

  /** Which bus on this board is the one that follow is watching. */
  reading(follow: FollowDocument, board: Departure[], now: Date) {
    return identify(
      board,
      {
        line: follow.line,
        destination: follow.destination,
        anchor: follow.anchor,
        taken: follow.taken,
      },
      now,
    );
  }
}
