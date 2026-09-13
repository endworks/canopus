import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PushPlatform } from '@canopus/shared';
import { reportOnce } from '@canopus/nest';
import { FollowDocument } from '../schemas/follow.schema';
import { SubscriptionDocument } from '../schemas/subscription.schema';
import { ApnsService } from '../apns/apns.service';
import {
  alertPayload,
  startPayload,
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
  isArriving,
  instant,
  matching,
  Reading,
  shownMinutes,
} from './tracking';

/**
 * How often this loop wakes.
 *
 * Ten seconds, which is the fastest any stop is read — and most are not read
 * on every tick. What decides that is `intervalFor`.
 */
const CADENCE = 10_000;

/**
 * How often a stop is read, by the road its board came down.
 *
 * The operator serves the same stop two ways and they are not the same thing.
 * `api` is their own feed: it dates its own answer, it moves as they move, and
 * the transit service in front of it holds a reading for ten seconds — so
 * asking every ten is asking exactly as often as there can be something new.
 * `web` is their departure board scraped out of a page, which is slower to
 * change and dearer to fetch, and half a minute is as fine as it gets.
 *
 * A stop nobody has read yet is assumed to be the slow kind, because guessing
 * the other way spends somebody else's quota on a guess.
 */
const INTERVALS: Record<string, number> = { api: 10_000, web: 30_000 };
const SLOWEST = 30_000;

const intervalFor = (source?: string): number =>
  (source && INTERVALS[source]) ?? SLOWEST;

/**
 * The three sentences this service ever says out loud.
 *
 * The app names the same three — `DepartureMoment` in its shared logic — and
 * writes its own words for them. These are the words a push has to carry
 * itself, because a notification carries text and not a key.
 */
export type Moment = 'arriving' | 'arrived' | 'gone';

/** Whether this phone has already been rung at about that moment. */
const rungAt = (follow: FollowDocument, moment: Moment): boolean =>
  (follow.rung ?? []).includes(moment);

/** How long before the arrival the phone is nudged. */
const LEAD = 60_000;

/**
 * How far back out a departure has to move before the minute's warning is worth
 * making again.
 *
 * These estimates go backwards. A bus a minute away that hits traffic is three
 * minutes away a sweep later, and then a minute away again — and the second
 * minute is as worth hearing about as the first, because it is the one the
 * reader will actually walk out on. Ringing once per follow got that wrong.
 *
 * Above `LEAD` rather than equal to it so that a reading wobbling either side of
 * sixty seconds rings once and not on every sweep: the departure has to have
 * genuinely gone away again, not merely jittered.
 */
const REARM = 180_000;

/**
 * How many times the last word is attempted before the row is let go.
 *
 * Three sweeps, which is half a minute of a network being briefly unreachable
 * — and after that, silence is better than a service holding a row open for
 * an hour to say one thing to a phone that is not listening.
 */
const ENDINGS = 3;

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

  /**
   * When each stop was last read, and down which road.
   *
   * In memory rather than on the follow, because it belongs to the stop and
   * not to whoever is waiting at it: a hundred followers of one pole share one
   * reading and therefore one clock. A restart loses it, which costs one early
   * read per stop and nothing else.
   */
  private readonly lastRead = new Map<
    string,
    { at: number; source?: string }
  >();

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
    // be rather than the way a watch normally ends.
    for (const stale of await this.follows.expired()) {
      await this.end(stale, [], new Date());
    }

    const live = await this.follows.live();
    if (!live.length) return;

    // Grouped by the stop, because that is what a request costs. Every bus
    // being watched at one pole shares one reading of it, and every phone
    // waiting for one of those buses shares that bus's answer.
    const byStop = new Map<string, SubscriptionDocument[]>();
    for (const subscription of live) {
      const key = `${subscription.kind}:${subscription.stopId}`;
      const group = byStop.get(key) ?? [];
      group.push(subscription);
      byStop.set(key, group);
    }

    // A stop nobody is waiting at any more keeps no clock.
    for (const key of this.lastRead.keys()) {
      if (!byStop.has(key)) this.lastRead.delete(key);
    }

    const now = new Date();
    await Promise.all(
      [...byStop.entries()].map(async ([key, group]) => {
        // Each stop on its own clock, set by the road its board came down:
        // there is nothing new to find at a scraped board every ten seconds,
        // and there may be at the operator's own feed.
        const last = this.lastRead.get(key);
        if (last && now.getTime() - last.at < intervalFor(last.source)) return;

        const [kind, stopId] = key.split(':');
        const board = await this.follows.board(kind, stopId);
        this.lastRead.set(key, { at: now.getTime(), source: board.source });
        // Nothing came back. Silence is the honest answer: the phone keeps the
        // last reading, and its own countdown goes on ticking.
        if (!board.times.length) return;
        for (const subscription of group) {
          await this.answer(subscription, board.times, now);
        }
      }),
    );
  }

  /**
   * A reading now, because somebody asked for one.
   *
   * What the button on a Lock Screen countdown reaches, and what sends the
   * first reading the moment a departure is taken on — without it the phone
   * waits for the board to CHANGE before it hears anything, which on a wait
   * that is holding steady is a minute of silence at the exact moment somebody
   * asked to be told about a bus.
   *
   * It answers for the bus, so everybody waiting for it hears the same thing
   * at the same time, whoever pressed the button.
   *
   * Best-effort and silent: the follow is already made, and a reading that
   * fails to send is a countdown that starts half a minute later rather than
   * an error anybody can act on.
   */
  async announce(id: string): Promise<void> {
    try {
      const follow = await this.follows.byId(id);
      if (!follow) {
        this.logger.warn(`Nothing to announce: follow ${id} is already gone.`);
        return;
      }
      const subscription = await this.follows.subscriptionOf(follow);
      if (!subscription) {
        this.logger.warn(
          `Nothing to announce: follow ${id} points at a subscription that is not there.`,
        );
        return;
      }
      const now = new Date();
      const { times } = await this.follows.board(
        subscription.kind,
        subscription.stopId,
      );
      const reading = this.follows.reading(subscription, times, now);
      // The one silence a reader cannot tell from this service being dead: the
      // follow is saved, the first push never goes out, and nothing anywhere
      // says so. It happens when the row leaves the board in the seconds
      // between the app reading it and this re-reading it.
      if (!reading) {
        this.logger.warn(
          `The ${subscription.line} to ${subscription.destination} was gone from ${subscription.kind}:${subscription.stopId} before the first reading; nothing was sent.`,
        );
        return;
      }
      const arriving = isArriving(reading.words);
      const waiting = await this.follows.followersOf(subscription);
      // The first reading is the one that puts a countdown on the phone, and it
      // is the only push that does not wait for the estimate to move. If it
      // does not go out, nothing else will for two minutes and the reader is
      // looking at a screen with nothing on it.
      this.logger.log(
        `Announcing the ${subscription.line} to ${subscription.destination}: ${waiting.length} waiting, board says "${reading.words}".`,
      );
      for (const one of waiting) {
        const sent = await this.push(subscription, one, reading, now, arriving);
        this.logger.log(
          `First reading to ${one.platform}: ${sent ? 'delivered' : 'NOT delivered'}.`,
        );
      }
      await this.recorded(subscription, reading, now, arriving);
    } catch (error) {
      this.logger.warn(`Reading not sent: ${(error as Error).message}`);
    }
  }

  /**
   * What this board means for one bus, and therefore for everybody waiting
   * for it.
   *
   * One identification, one decision, and then the same words to every phone
   * following it — which is what the subscription is for. The only thing left
   * that is decided per phone is which moments have rung, because `rung` is
   * a thing that has happened to one phone and ringing a second time is not
   * made better by company.
   */
  private async answer(
    subscription: SubscriptionDocument,
    board: Departure[],
    now: Date,
  ): Promise<void> {
    const reading = this.follows.reading(subscription, board, now);
    if (!reading) {
      await this.answerLost(subscription, board, now);
      return;
    }

    const waiting = await this.follows.followersOf(subscription);
    // A bus nobody is waiting for any more. It can happen between sweeps —
    // the last reader unfollowed as this one was reading — and there is
    // nothing to say and no reason to go on reading.
    if (!waiting.length) {
      this.logger.log(
        `Nobody is waiting for the ${subscription.line} to ${subscription.destination} any more; letting it go.`,
      );
      await this.follows.close(subscription);
      return;
    }

    // Coming in. Said to everybody at once, and the watch lives on: this is
    // the moment they are standing there for, not the end of it. The end is
    // the board dropping the row, which is `answerLost`.
    const arriving = isArriving(reading.words);
    const speak =
      this.moved(subscription, reading, now) ||
      arriving !== subscription.arriving;

    const wait = reading.arrival.getTime() - now.getTime();
    for (const follow of waiting) {
      // The bus went away again, so the warning is worth making again.
      if (wait > REARM && rungAt(follow, 'arriving')) {
        await this.unrang(follow, 'arriving');
      }
      if (!rungAt(follow, 'arriving') && wait <= LEAD) {
        await this.nudge(subscription, follow, reading, now);
        continue;
      }
      if (speak) await this.push(subscription, follow, reading, now, arriving);
    }
    if (speak) await this.recorded(subscription, reading, now, arriving);
  }

  /**
   * Whether this reading says anything the followers have not been told.
   *
   * Asked of the bus rather than of a phone, which is what keeps two people at
   * one pole seeing one number: the minutes last shown, the words last sent
   * and the moment they were sent belong to the subscription now.
   *
   * The number on the glass, as the reader reads it, is what this service
   * exists to keep true — so it is what decides whether to speak: every minute
   * it changes, they are told, until the vehicle is there. Not the same
   * question as `agrees`, and both are asked. The phone ticks its own
   * countdown, so the minutes can change with the board saying exactly what it
   * said before; and the board can move without the minutes changing, which is
   * an estimate that slipped inside a minute and is still worth sending,
   * because the instant behind it is what the phone counts to. CONFIRM is
   * under both: silence for longer than that is indistinguishable from a
   * service that has died.
   */
  private moved(
    subscription: SubscriptionDocument,
    reading: Reading,
    now: Date,
  ): boolean {
    if (shownMinutes(reading.arrival, now) !== subscription.shown) return true;
    if (!agrees(subscription, reading, now)) return true;
    return now.getTime() - subscription.taken.getTime() >= CONFIRM;
  }

  /**
   * A bus that is no longer on the board.
   *
   * Which of the two endings that is depends on what its followers were last
   * told: a vehicle that disappears while it was still four minutes away was
   * overtaken by the reading and is gone, and one that disappears after being
   * called a minute away — or pulling in — has arrived. Many boards drop a
   * departure as it reaches the stop rather than ever printing `En parada`,
   * and the tram never prints one at all. Saying "departed" to somebody
   * watching their bus pull in is the one mistake here that sends them home.
   */
  private async answerLost(
    subscription: SubscriptionDocument,
    board: Departure[],
    now: Date,
  ): Promise<void> {
    const close =
      subscription.arriving || (subscription.shown ?? Infinity) <= 1;
    const due = subscription.anchor.getTime() - now.getTime();
    // The row left the board, and this is the judgement made of that: near its
    // own arrival it means the bus is here, and far from it that the bus was
    // lost. Said out loud with the numbers, because the two ring different
    // sentences and a board that drops rows early makes the wrong one.
    this.logger.log(
      `The ${subscription.line} to ${subscription.destination} left the board ${Math.round(due / 1000)}s from its arrival (shown ${subscription.shown ?? '-'}, arriving ${subscription.arriving ?? false}); calling it ${close || (due <= ARRIVING && due > -ARRIVING) ? 'arrived' : 'gone'}.`,
    );
    if (close || (due <= ARRIVING && due > -ARRIVING)) {
      await this.arrive(subscription, now);
      return;
    }
    await this.end(subscription, board, now);
  }

  /**
   * The vehicle is at the stop, and everybody waiting for it is told so.
   *
   * An end rather than an update, and a different end from a departure: the
   * banner says it is here rather than that it has been and gone, and then
   * takes itself away. It rings for anybody who never got the minute-before
   * nudge — a bus that went from three minutes to standing at the pole between
   * two readings is exactly the one they wanted telling about.
   */
  private async arrive(
    subscription: SubscriptionDocument,
    now: Date,
  ): Promise<void> {
    const reading: Reading = {
      arrival: subscription.anchor,
      words: subscription.words,
    };
    const state = contentState(reading, now, false, true);
    await this.finish(subscription, state, now, true);
  }

  /**
   * It went. The board stopped listing it while it was still minutes away,
   * which means the reading moved on to the one behind it.
   */
  private async end(
    subscription: SubscriptionDocument,
    board: Departure[],
    now: Date,
  ): Promise<void> {
    // What is left of this line, which is the question somebody who has just
    // watched their bus pull out is asking. The soonest row, because theirs is
    // no longer on the board at all.
    const behind = matching(
      board,
      subscription.line,
      subscription.destination,
    )[0];
    const state = contentState(
      {
        arrival: subscription.anchor,
        words: subscription.words,
        next: behind ? instant(behind.time, now) : undefined,
        nextWords: behind?.time,
      },
      now,
      true,
    );
    await this.finish(subscription, state, now, false);
  }

  /**
   * The last word, said to everybody waiting, and then both rows go.
   *
   * Retried rather than dropped on a bad minute. Every other reading is
   * followed by another half a minute later; this one is the last thing this
   * service will ever say about this vehicle, and a phone that misses it keeps
   * a countdown to a bus it is already standing on. Three sweeps, and then the
   * watch is let go whatever happened — after that, silence is better than a
   * row held open for an hour to speak to a phone that is not listening.
   */
  private async finish(
    subscription: SubscriptionDocument,
    state: ReturnType<typeof contentState>,
    now: Date,
    arrived: boolean,
  ): Promise<void> {
    const waiting = await this.follows.followersOf(subscription);
    let missed = false;
    for (const follow of waiting) {
      // Both endings are worth a sound, and each is worth one. Reaching the
      // pole and pulling away from it are different sentences to somebody
      // looking at a Lock Screen, and the leaving used to be silent because
      // only `arrived` was ever asked about.
      const moment = arrived ? 'arrived' : 'gone';
      const alert =
        !rungAt(follow, moment) && (await this.rings(follow))
          ? {
              title: subscription.stopName,
              body: this.words(subscription, follow, moment),
            }
          : undefined;
      const sent = await this.sendEnding(subscription, follow, state, alert);
      // The last thing said to one phone, and whether it was said out loud.
      // "I only ever get one notification" is answered here or nowhere: either
      // the ending carried no alert, or it carried one and did not land.
      this.logger.log(
        `Ending (${moment}) for ${follow.platform}: ${
          alert ? 'with a sound' : 'silent'
        }${rungAt(follow, moment) ? ' (already rung)' : ''}, ${
          sent ? 'delivered' : 'NOT delivered'
        }.`,
      );
      if (!sent) missed = true;
      else if (alert) await this.rang(follow, moment);
    }
    if (missed && (subscription.attempts ?? 0) < ENDINGS) {
      subscription.attempts = (subscription.attempts ?? 0) + 1;
      await subscription.save();
      return;
    }
    this.silent(subscription, waiting);
    await this.follows.close(subscription);
  }

  /**
   * A departure that ended having said nothing out loud, said out loud here.
   *
   * Every other warning in this service names a thing that went wrong at one
   * step. This names the only outcome that matters to a reader — they followed
   * a bus and their phone never made a sound — and it is the one thing none of
   * the step-by-step failures adds up to on its own.
   */
  private silent(
    subscription: SubscriptionDocument,
    waiting: FollowDocument[],
  ): void {
    const quiet = waiting.filter((follow) => !(follow.rung ?? []).length);
    if (!quiet.length) return;
    this.logger.warn(
      `${quiet.length} of ${waiting.length} following the ${subscription.line} to ${subscription.destination} at ${subscription.stopKey} heard nothing before it ended.`,
    );
    reportOnce(
      'push.silent-departure',
      'A departure ended with followers who were never rung: somebody waited for a bus and their phone said nothing.',
    );
  }

  /** One reading, to one phone. */
  private async push(
    subscription: SubscriptionDocument,
    follow: FollowDocument,
    reading: Reading,
    now: Date,
    arriving: boolean,
  ): Promise<boolean> {
    const state = contentState(reading, now, false, false, arriving);
    if (follow.platform === 'android') {
      return this.pushData(subscription, follow, state);
    }
    return follow.activityToken
      ? this.pushActivity(follow, updatePayload(state))
      : this.startActivity(subscription, follow, state);
  }

  /** What the bus was last told to say, written down for the next reading. */
  private async recorded(
    subscription: SubscriptionDocument,
    reading: Reading,
    now: Date,
    arriving: boolean,
  ): Promise<void> {
    subscription.anchor = reading.arrival;
    subscription.words = reading.words;
    subscription.nextWords = reading.nextWords;
    subscription.shown = shownMinutes(reading.arrival, now);
    subscription.position = reading.position ?? subscription.position;
    subscription.arriving = arriving;
    subscription.taken = now;
    await subscription.save();
  }

  /**
   * About a minute away, at one phone.
   *
   * The one decision left that is personal: `rung` is something that has
   * happened to this phone, and it must not ring again because somebody else
   * joined the same wait a minute later.
   *
   * Carried on the activity update itself where there is one — the same push
   * that moves the countdown also rings, so the phone buzzes once and the
   * banner it draws attention to is already right. Where there is no activity
   * it is an ordinary notification.
   */
  private async nudge(
    subscription: SubscriptionDocument,
    follow: FollowDocument,
    reading: Reading,
    now: Date,
  ): Promise<void> {
    const minutes = shownMinutes(reading.arrival, now);
    const alert = {
      title: subscription.stopName,
      body: this.words(subscription, follow, 'arriving', minutes),
    };
    const state = contentState(reading, now);
    // The switch is asked about here and nowhere else in this loop, and the
    // line is worth stating: moving a countdown the reader started is not a
    // notification and needs no permission. Making the phone ring is, and a
    // reader who turned arrivals off has said not to.
    const allowed = await this.rings(follow);
    let sent: boolean;
    if (follow.platform === 'android') {
      // Android draws its own notification out of the data, so whether it
      // rings is a flag in the payload rather than a second message.
      sent = await this.pushData(
        subscription,
        follow,
        state,
        allowed ? { alert } : {},
      );
    } else if (follow.activityToken) {
      sent = await this.pushActivity(
        follow,
        updatePayload(state, allowed ? alert : undefined),
      );
    } else {
      // No banner of its own, so one is raised from here — carrying the sound,
      // which is one buzz and a countdown already on screen rather than a
      // notification about a countdown that is not. A phone too old to be
      // given one, or that has never sent a push-to-start token, still gets
      // the plain alert it always did.
      sent =
        (await this.startActivity(
          subscription,
          follow,
          state,
          allowed ? alert : undefined,
        )) ||
        (allowed &&
          (await this.notifyDevice(
            follow,
            alertPayload(alert.title, alert.body),
          )));
    }
    if (!sent) return;
    await this.rang(follow, 'arriving');
  }

  /**
   * The words, in the reader's own language.
   *
   * Two of them, chosen here rather than in the app because a push carries
   * text and not a key. Which bus is the subscription's; which language is the
   * follow's — the app's own setting, which is not always the phone's.
   */
  private words(
    subscription: SubscriptionDocument,
    follow: FollowDocument,
    moment: Moment,
    minutes = 1,
  ): string {
    const spanish = (follow.locale ?? 'es').startsWith('es');
    const line = spanish
      ? `${subscription.line} hacia ${subscription.destination}`
      : `${subscription.line} to ${subscription.destination}`;
    if (moment === 'gone') {
      return spanish
        ? `La línea ${line} ha salido de la parada`
        : `Line ${line} has left the stop`;
    }
    if (moment === 'arrived') {
      return spanish
        ? `La línea ${line} está en la parada`
        : `Line ${line} is at the stop`;
    }
    if (minutes <= 0) {
      return spanish
        ? `La línea ${line} está llegando`
        : `Line ${line} is arriving`;
    }
    return spanish
      ? `La línea ${line} llega en un minuto aproximadamente`
      : `Line ${line} is about a minute away`;
  }

  /** Written down at the phone it rang at, so a retry does not ring it again. */
  private async rang(follow: FollowDocument, moment: Moment): Promise<void> {
    follow.rung = [...(follow.rung ?? []), moment];
    await this.follows.rang(follow, moment);
  }

  /**
   * Forget that a moment rang, so it can ring again.
   *
   * Only ever the minute's warning: the two endings happen once to a departure
   * and close the watch behind them, so there is nothing left for them to ring
   * a second time about.
   */
  private async unrang(follow: FollowDocument, moment: Moment): Promise<void> {
    follow.rung = (follow.rung ?? []).filter((rung) => rung !== moment);
    await this.follows.unrang(follow, moment);
  }

  /** Whether this phone has agreed to be rung at about arrivals. */
  private rings(follow: FollowDocument): Promise<boolean> {
    return this.devices.accepts(follow.token, 'arrivals');
  }

  /**
   * A push addressed at the Live Activity itself.
   *
   * Its own token and its own topic: this reaches the banner on a locked
   * screen without the app being involved, which is the one thing the client
   * could never do for itself.
   */
  /**
   * The last word, by whatever route this phone can still be reached.
   *
   * A banner this service raised itself can only be ended once the phone has
   * reported the activity's own token back — push-to-start addresses the *kind*
   * of activity and nothing else, so there is no way to end one from here
   * without it. The app reports it (`watchActivities`), `refreshFollow` records
   * it, and the ending then goes out as an ordinary activity push. A phone that
   * never reports one keeps a banner until its `stale-date` takes it down, and
   * hears the ending as a plain notification.
   */
  private async sendEnding(
    subscription: SubscriptionDocument,
    follow: FollowDocument,
    state: ReturnType<typeof contentState>,
    alert?: { title: string; body: string },
  ): Promise<boolean> {
    if (follow.platform === 'android') {
      return this.pushData(subscription, follow, state, alert ? { alert } : {});
    }
    if (follow.activityToken) {
      return this.pushActivity(follow, endPayload(state, alert));
    }
    return alert
      ? this.notifyDevice(follow, alertPayload(alert.title, alert.body))
      : true;
  }

  /**
   * Raise a banner on a phone that drew none of its own.
   *
   * The app asks to be followed with no activity token when its own fallback is
   * switched off, and this is what answers: the push-to-start token addresses
   * the kind of activity rather than a running one. False rather than an
   * incident when there is no such token — a phone before 17.2, or one that has
   * not sent one yet — and the caller falls back to what it did before.
   */
  private async startActivity(
    subscription: SubscriptionDocument,
    follow: FollowDocument,
    state: ReturnType<typeof contentState>,
    alert?: { title: string; body: string },
  ): Promise<boolean> {
    if (follow.platform !== ('ios' as PushPlatform)) return false;
    const token = await this.devices.pushToStartToken(follow.token);
    // Said out loud rather than shrugged off. A banner that never appears looks
    // identical from the phone whether this end had nothing to address, or
    // addressed it and Apple refused — and the reader gets the same plain
    // notification either way, which is the fallback working and hiding it.
    if (!token) {
      this.logger.warn(
        `No push-to-start token for the phone following ${follow.subscription.toString()}; it will get a notification instead of a banner.`,
      );
      reportOnce(
        'push.no-push-to-start-token',
        'A followed departure had no push-to-start token to raise a banner with; readers are getting notifications instead.',
      );
      return false;
    }
    const raised = await this.deliver(
      follow,
      token,
      startPayload(
        {
          stop: subscription.stopName,
          stopKey: subscription.stopKey,
          stopId: subscription.stopId,
          kindKey: subscription.kind,
          line: subscription.line,
          destination: subscription.destination,
        },
        state,
        alert,
      ),
      {
        pushType: 'liveactivity',
        topicSuffix: ACTIVITY_TOPIC,
        expiration: Math.round(Date.now() / 1000) + 120,
        collapseId: follow.id as string,
      },
    );
    if (!raised) {
      this.logger.warn(
        `Apple would not raise a banner for ${follow.subscription.toString()}; falling back to a notification.`,
      );
      reportOnce(
        'push.start-refused',
        'Apple refused a push-to-start; no Live Activity is being raised for anybody.',
      );
    }
    return raised;
  }

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
    subscription: SubscriptionDocument,
    follow: FollowDocument,
    state: ReturnType<typeof contentState>,
    extras: { alert?: { title: string; body: string } } = {},
  ): Promise<boolean> {
    const data: Record<string, string> = {
      followId: follow.id as string,
      stopKey: subscription.stopKey,
      stopId: subscription.stopId,
      stopName: subscription.stopName,
      line: subscription.line,
      destination: subscription.destination,
      kind: subscription.kind,
      arrival: String(state.arrival),
      words: state.words,
      taken: String(state.taken),
      gone: String(state.gone),
      arrived: String(state.arrived),
      arriving: String(state.arriving),
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
