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
import { FcmService } from '../fcm/fcm.service';
import { DevicesService } from './devices.service';
import { FollowsService } from './follows.service';
import {
  agrees,
  Departure,
  hasArrived,
  instant,
  matching,
  Reading,
  shownMinutes,
} from './tracking';

/**
 * How often a followed stop is read.
 *
 * Thirty seconds. The operator publishes whole minutes and the transit service
 * holds a board for ten, so the thing being watched for — a minute that
 * changed — cannot happen more than twice within one of these, and is caught
 * within half a minute of happening. Faster reading buys resolution the source
 * does not have and spends somebody else's quota to do it.
 */
const CADENCE = 30_000;

/** How long before the arrival the phone is nudged. */
const LEAD = 60_000;

/**
 * How near its own arrival a departure has to be for vanishing to mean it
 * arrived rather than that it was lost.
 *
 * Ninety seconds either side: one sweep plus the drift these estimates have.
 */
const ARRIVING = 90_000;

/**
 * How long a phone may go without hearing anything before it is told again.
 *
 * Every other push here is a disagreement, and agreement is the ordinary case:
 * a countdown ticking down in step with the board contradicts nothing, so a
 * departure whose estimate holds is served in silence. That silence is correct
 * and it is also indistinguishable from this service being dead, a token gone
 * stale, or APNs refusing — and the app stops reading the board for itself
 * once it has been handed over, so nobody would notice.
 *
 * Two minutes, then, the same reading sent again: it costs one push per follow
 * per two minutes, it re-dates what the banner says it was confirmed at, and
 * it is the only thing that lets a client tell a quiet road from a broken one.
 */
const CONFIRM = 120_000;

/** The Live Activity's own topic, which is the app's with this on the end. */
const ACTIVITY_TOPIC = '.push-type.liveactivity';

/**
 * The countdowns, kept true.
 *
 * This is the loop the whole push service exists for. Every half a minute it
 * reads the stops that somebody is actually waiting at — one read per stop, no
 * matter how many people that is — and tells each phone only what has changed
 * for it.
 *
 * Four things can come out of a reading, and one of them is not a push:
 *
 * - the board says what the phone is already showing, which is most readings
 *   and costs nothing;
 * - the wait has moved, which is an update;
 * - the bus is at the stop, which is what the reader asked to be told and the
 *   end of the follow: they are getting on it;
 * - the bus is gone, which is an end too, said out loud rather than left as a
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
    private readonly fcm: FcmService,
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
    // The ones whose hour is up, first. Mongo's TTL index would drop these
    // rows on its own and tell nobody, leaving an ongoing notification on a
    // phone counting down to a bus this service stopped watching — so they are
    // ended out loud here, and the index becomes the backstop it was meant to
    // be rather than the way follows normally end.
    for (const stale of await this.follows.expired()) {
      await this.end(stale, [], new Date());
    }

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

  /**
   * The first reading, pushed the moment a follow is taken on.
   *
   * Without it the phone waits for the board to CHANGE before it hears
   * anything, because every other push in this service is a disagreement with
   * what the reader is already looking at. On a wait that is holding steady
   * that is a minute of silence at the exact moment somebody has just asked to
   * be told about a bus — and on Android, where the notification is drawn from
   * the push and from nothing else, it is a minute of nothing on screen.
   *
   * It is also the only proof either end gets that the road works. The app
   * stops reading the board for itself once this lands; a push that never
   * arrives leaves it reading, which is the right way round.
   *
   * Best-effort and silent: the follow is already made, and a first push that
   * fails is a countdown that starts a minute later rather than an error
   * anybody can act on.
   */
  async announce(id: string): Promise<void> {
    try {
      const follow = await this.follows.byId(id);
      if (!follow) return;
      const now = new Date();
      const board = await this.follows.board(follow.kind, follow.stopId);
      const reading = this.follows.reading(follow, board, now);
      // Nothing to say yet. The next sweep will find it, and
      // the app is still reading for itself until something arrives.
      if (!reading) return;
      await this.update(follow, reading, now);
    } catch (error) {
      this.logger.warn(`First reading not sent: ${(error as Error).message}`);
    }
  }

  /** What this board means for one phone. */
  private async answer(
    follow: FollowDocument,
    board: Departure[],
    now: Date,
  ): Promise<void> {
    const reading = this.follows.reading(follow, board, now);
    if (!reading) {
      // Off the board. Which of the two endings that is depends on where its
      // own countdown had got to: a bus that disappears while it was still
      // four minutes away was overtaken by the next reading and is gone, and
      // one that disappears as it was due has arrived — many boards drop a
      // departure at the stop rather than ever printing `En parada`. Saying
      // "departed" to somebody watching their bus pull in is the one mistake
      // here that would send them home.
      const due = follow.anchor.getTime() - now.getTime();
      if (due <= ARRIVING && due > -ARRIVING) {
        await this.arrive(
          follow,
          { arrival: follow.anchor, words: follow.words },
          now,
        );
        return;
      }
      await this.end(follow, board, now);
      return;
    }
    // Here. The last thing worth saying about this bus, and then the follow
    // goes: what is read after this is a bus the reader is sitting on, and
    // nothing about it belongs on their Lock Screen.
    if (hasArrived(reading.words)) {
      await this.arrive(follow, reading, now);
      return;
    }
    // The minute-before nudge, before the agreement check: a wait that has not
    // changed still crosses the one-minute mark, and that is the moment this
    // whole feature was asked for.
    if (!follow.alerted && reading.arrival.getTime() - now.getTime() <= LEAD) {
      await this.nudge(follow, reading, now);
      return;
    }
    // The number on the glass, as the reader reads it. It is what this
    // service exists to keep true, so it is what decides whether to speak:
    // every minute it changes, they are told, until the bus is there.
    //
    // Not the same question as `agrees`, and both are asked. The phone ticks
    // its own countdown, so the minutes can change with the board saying
    // exactly what it said before — and the board can move without the minutes
    // changing, which is an estimate that slipped inside a minute and is still
    // worth sending, because the instant behind it is what the phone counts
    // to. CONFIRM is under both: silence for longer than that is
    // indistinguishable from a service that has died.
    const minutes = shownMinutes(reading.arrival, now);
    if (
      minutes === follow.shown &&
      agrees(follow, reading, now) &&
      now.getTime() - follow.taken.getTime() < CONFIRM
    ) {
      return;
    }
    await this.update(follow, reading, now);
  }

  /**
   * The bus is at the stop.
   *
   * An end rather than an update, and a different end from a departure: the
   * banner says the bus is here rather than that it has been and gone, and
   * then takes itself away. It rings where the reader never got the
   * minute-before nudge — a bus that went from three minutes to standing at
   * the pole between two readings is exactly the one they wanted telling
   * about.
   */
  private async arrive(
    follow: FollowDocument,
    reading: Reading,
    now: Date,
  ): Promise<void> {
    const state = contentState(reading, now, false, true);
    const alert =
      !follow.alerted && (await this.devices.accepts(follow.token, 'arrivals'))
        ? { title: follow.stopName, body: this.words(follow, 0) }
        : undefined;
    if (follow.platform === 'android') {
      await this.pushData(follow, state, alert ? { alert } : {});
    } else if (follow.activityToken) {
      await this.pushActivity(follow, endPayload(state, alert));
    } else if (alert) {
      await this.notifyDevice(follow, alertPayload(alert.title, alert.body));
    }
    await this.follows.remove({ id: follow.id as string });
  }

  private async update(
    follow: FollowDocument,
    reading: Reading,
    now: Date,
  ): Promise<void> {
    const state = contentState(reading, now);
    const sent =
      follow.platform === 'android'
        ? await this.pushData(follow, state)
        : await this.pushActivity(follow, updatePayload(state));
    if (!sent) return;
    follow.anchor = reading.arrival;
    follow.words = reading.words;
    follow.shown = shownMinutes(reading.arrival, now);
    follow.position = reading.position ?? follow.position;
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
    const allowed = await this.devices.accepts(follow.token, 'arrivals');
    let sent: boolean;
    if (follow.platform === 'android') {
      // Android draws its own notification out of the data, so whether it
      // rings is a flag in the payload rather than a second message.
      sent = await this.pushData(follow, state, allowed ? { alert } : {});
    } else if (follow.activityToken) {
      sent = await this.pushActivity(
        follow,
        updatePayload(state, allowed ? alert : undefined),
      );
    } else {
      sent =
        allowed &&
        (await this.notifyDevice(
          follow,
          alertPayload(alert.title, alert.body),
        ));
    }
    if (!sent) return;
    follow.alerted = true;
    follow.anchor = reading.arrival;
    follow.words = reading.words;
    follow.shown = minutes;
    follow.position = reading.position ?? follow.position;
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
  private async end(
    follow: FollowDocument,
    board: Departure[],
    now: Date,
  ): Promise<void> {
    // What is left of this line, which is the question somebody who has just
    // watched their bus pull out is asking. The soonest row, because theirs is
    // no longer on the board at all.
    const behind = matching(board, follow.line, follow.destination)[0];
    const state = contentState(
      {
        arrival: follow.anchor,
        words: follow.words,
        next: behind ? instant(behind.time, now) : undefined,
        nextWords: behind?.time,
      },
      now,
      true,
    );

    if (follow.platform === 'android') {
      await this.pushData(follow, state);
    } else {
      await this.pushActivity(follow, endPayload(state));
    }
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

  /**
   * The same reading, as data, for a phone that draws its own.
   *
   * Every value is a string because that is all FCM data carries. The app
   * reads them back into the ongoing notification it is already showing — see
   * `DepartureNotification` — so what arrives is an edit of what is on screen
   * rather than another banner under it.
   *
   * The collapse key is the follow, so a phone that was out of signal for two
   * minutes wakes to the newest reading and not to eight stale ones.
   */
  private async pushData(
    follow: FollowDocument,
    state: ReturnType<typeof contentState>,
    extras: { alert?: { title: string; body: string } } = {},
  ): Promise<boolean> {
    const data: Record<string, string> = {
      followId: follow.id as string,
      stopKey: follow.stopKey,
      stopName: follow.stopName,
      line: follow.line,
      destination: follow.destination,
      kind: follow.kind,
      arrival: String(state.arrival),
      words: state.words,
      taken: String(state.taken),
      gone: String(state.gone),
      arrived: String(state.arrived),
    };
    if (state.next !== undefined) data.next = String(state.next);
    if (state.nextWords) data.nextWords = state.nextWords;
    if (extras.alert) {
      data.alertTitle = extras.alert.title;
      data.alertBody = extras.alert.body;
    }
    const result = await this.fcm.send(follow.token, data, {
      collapseKey: follow.id as string,
    });
    if (result === 'gone') {
      this.logger.log('A device is gone; dropping it and what it followed.');
      await this.devices.retire(follow.token);
      await this.follows.removeForToken(follow.token);
      return false;
    }
    return result === 'sent';
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
   * is not retried on every sweep for an hour, which is what a registry
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
      await this.follows.removeForToken(follow.token);
      return false;
    }
    return result === 'sent';
  }
}
