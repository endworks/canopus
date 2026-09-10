import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PushPlatform } from '@canopus/shared';
import { FollowDocument } from '../schemas/follow.schema';
import { ApnsService } from '../apns/apns.service';
import {
  alertPayload,
  contentState,
  endPayload,
  updatePayload,
} from '../apns/payloads';
import { DevicesService } from './devices.service';
import { FollowsService } from './follows.service';
import { agrees, Departure, Reading, shownMinutes } from './tracking';

/**
 * How often a followed stop is read.
 *
 * Fifteen seconds, and not less. The transit service holds a board for ten,
 * the operator publishes whole minutes, and the thing being watched for — a
 * wait that changed — cannot happen faster than the source moves. Below this
 * the extra requests buy nothing and spend somebody else's quota.
 */
const CADENCE = 15_000;

/** How long before the arrival the phone is nudged. */
const LEAD = 60_000;

/** The Live Activity's own topic, which is the app's with this on the end. */
const ACTIVITY_TOPIC = '.push-type.liveactivity';

/**
 * The countdowns, kept true.
 *
 * This is the loop the whole push service exists for. Every fifteen seconds it
 * reads the stops that somebody is actually waiting at — one read per stop, no
 * matter how many people that is — and tells each phone only what has changed
 * for it.
 *
 * Three things can come out of a reading, and only one of them is a push:
 *
 * - the board says what the phone is already showing, which is most readings
 *   and costs nothing;
 * - the wait has moved, which is an update;
 * - the bus is gone, which is an end, said out loud rather than left as a
 *   countdown that quietly ran out.
 *
 * A read that fails says nothing at all. A gateway having a bad minute must
 * not read as every bus in the city having left.
 */
@Injectable()
export class ArrivalsService {
  private readonly logger = new Logger(ArrivalsService.name);
  private running = false;

  constructor(
    private readonly follows: FollowsService,
    private readonly devices: DevicesService,
    private readonly apns: ApnsService,
  ) {}

  @Interval(CADENCE)
  async tick(): Promise<void> {
    // A tick that overruns is skipped rather than stacked: two of these at
    // once would read every stop twice and race each other's writes.
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error(`Arrival sweep failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sweep(): Promise<void> {
    const live = await this.follows.live();
    if (!live.length) return;

    // Grouped by the stop, because that is what a request costs. Everybody
    // waiting at one pole shares one reading of it.
    const byStop = new Map<string, FollowDocument[]>();
    for (const follow of live) {
      const key = `${follow.kind}:${follow.stopId}`;
      const group = byStop.get(key) ?? [];
      group.push(follow);
      byStop.set(key, group);
    }

    const now = new Date();
    await Promise.all(
      [...byStop.entries()].map(async ([key, group]) => {
        const [kind, stopId] = key.split(':');
        const board = await this.follows.board(kind, stopId);
        // Nothing came back. Silence is the honest answer: the phone keeps the
        // last reading, with its own age printed under it.
        if (!board.length) return;
        for (const follow of group) {
          await this.answer(follow, board, now);
        }
      }),
    );
  }

  /** What this board means for one phone. */
  private async answer(
    follow: FollowDocument,
    board: Departure[],
    now: Date,
  ): Promise<void> {
    const reading = this.follows.reading(follow, board, now);
    if (!reading) {
      await this.end(follow, now);
      return;
    }
    // The minute-before nudge, before the agreement check: a wait that has not
    // changed still crosses the one-minute mark, and that is the moment this
    // whole feature was asked for.
    if (!follow.alerted && reading.arrival.getTime() - now.getTime() <= LEAD) {
      await this.nudge(follow, reading, now);
      return;
    }
    if (agrees(follow, reading, now)) return;
    await this.update(follow, reading, now);
  }

  private async update(
    follow: FollowDocument,
    reading: Reading,
    now: Date,
  ): Promise<void> {
    const state = contentState(reading, now);
    const sent = await this.pushActivity(follow, updatePayload(state));
    if (!sent) return;
    follow.anchor = reading.arrival;
    follow.words = reading.words;
    follow.taken = now;
    await follow.save();
  }

  /**
   * About a minute away.
   *
   * Carried on the activity update itself where there is one — the same push
   * that moves the countdown also rings, so the phone buzzes once and the
   * banner it draws attention to is already right. Where there is no activity
   * it is an ordinary notification.
   */
  private async nudge(
    follow: FollowDocument,
    reading: Reading,
    now: Date,
  ): Promise<void> {
    const minutes = shownMinutes(reading.arrival, now);
    const alert = {
      title: follow.stopName,
      body: this.words(follow, minutes),
    };
    const state = contentState(reading, now);
    // The switch is asked about here and nowhere else in this loop, and the
    // line is worth stating: moving a countdown the reader started is not a
    // notification and needs no permission. Making the phone ring is, and a
    // reader who turned arrivals off has said not to.
    const sent = follow.activityToken
      ? await this.pushActivity(follow, updatePayload(state, alert))
      : (await this.devices.accepts(follow.token, 'arrivals')) &&
        (await this.notifyDevice(
          follow,
          alertPayload(alert.title, alert.body),
        ));
    if (!sent) return;
    follow.alerted = true;
    follow.anchor = reading.arrival;
    follow.words = reading.words;
    follow.taken = now;
    await follow.save();
  }

  /**
   * The bus has gone.
   *
   * The row goes whatever the push does: something that is no longer coming
   * must not be read for again, and a phone that missed the end will let the
   * activity go stale on the date it already holds.
   */
  private async end(follow: FollowDocument, now: Date): Promise<void> {
    const state = contentState(
      { arrival: follow.anchor, words: follow.words },
      now,
      true,
    );
    await this.pushActivity(follow, endPayload(state));
    await this.follows.remove({ id: follow.id as string });
  }

  /**
   * The words, in the reader's own language.
   *
   * Two of them, chosen here rather than in the app because a push carries
   * text and not a key. The locale is the one the device registered with —
   * the app's own language, which is not always the phone's.
   */
  private words(follow: FollowDocument, minutes: number): string {
    const spanish = (follow.locale ?? 'es').startsWith('es');
    const line = `${follow.line} ${follow.destination}`;
    if (minutes <= 0) {
      return spanish
        ? `La línea ${line} está llegando`
        : `Line ${line} is arriving`;
    }
    return spanish
      ? `La línea ${line} llega en un minuto aproximadamente`
      : `Line ${line} is about a minute away`;
  }

  /**
   * A push addressed at the Live Activity itself.
   *
   * Its own token and its own topic: this reaches the banner on a locked
   * screen without the app being involved, which is the one thing the client
   * could never do for itself.
   */
  private async pushActivity(
    follow: FollowDocument,
    payload: unknown,
  ): Promise<boolean> {
    if (follow.platform !== ('ios' as PushPlatform)) return false;
    if (!follow.activityToken) return false;
    return this.deliver(follow, follow.activityToken, payload, {
      pushType: 'liveactivity',
      topicSuffix: ACTIVITY_TOPIC,
      // No point in Apple holding an arrival time: a countdown delivered late
      // is a countdown to a bus that has been.
      expiration: Math.round(Date.now() / 1000) + 120,
      collapseId: follow.id as string,
    });
  }

  /** An ordinary notification, at the phone rather than at a banner. */
  private async notifyDevice(
    follow: FollowDocument,
    payload: unknown,
  ): Promise<boolean> {
    if (follow.platform !== ('ios' as PushPlatform)) return false;
    return this.deliver(follow, follow.token, payload, { pushType: 'alert' });
  }

  /**
   * The send itself, and what a refusal means.
   *
   * A token Apple calls dead takes its device and its follows with it: the row
   * is not retried every fifteen seconds for an hour, which is what a registry
   * that never forgets turns into.
   */
  private async deliver(
    follow: FollowDocument,
    token: string,
    payload: unknown,
    options: {
      pushType: 'liveactivity' | 'alert';
      topicSuffix?: string;
      expiration?: number;
      collapseId?: string;
    },
  ): Promise<boolean> {
    const result = await this.apns.send(token, payload, {
      priority: 10,
      ...options,
    });
    if (result === 'gone') {
      this.logger.log('A device is gone; dropping it and what it followed.');
      await this.devices.retire(follow.token);
      await this.follows.remove({ id: follow.id as string });
      return false;
    }
    return result === 'sent';
  }
}
