import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ForgetDevicePayload,
  PUSH_CATEGORIES,
  PushCategory,
  RegisterDevicePayload,
  SetPreferencesPayload,
} from '@canopus/shared';
import { Device, DeviceDocument } from '../schemas/device.schema';

/** The wording a reader agreed to, bumped when the sentence changes. */
const CONSENT_WORDING = 'v1';

/** Anything the caller invented is dropped rather than stored. */
const known = (categories: string[]): PushCategory[] =>
  categories.filter((one): one is PushCategory =>
    (PUSH_CATEGORIES as readonly string[]).includes(one),
  );

/**
 * The device registry: who can be spoken to, and about what.
 *
 * Everything here is keyed by the push token, because that is the only name a
 * device has. A token that changes is a new row and the old one is orphaned
 * until the platform reports it dead — which is why `retiredAt` exists rather
 * than a delete.
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectModel(Device.name) private readonly devices: Model<DeviceDocument>,
  ) {}

  /**
   * A device saying hello, or saying what changed.
   *
   * Upserted on the token. Categories are only taken on the first sight of a
   * device: afterwards they are the reader's and a re-registration must not
   * quietly put back a switch they turned off.
   */
  async register(payload: RegisterDevicePayload): Promise<{ id: string }> {
    const existing = await this.devices.findOne({ token: payload.token });
    if (existing) {
      existing.app = payload.app;
      existing.platform = payload.platform;
      if (payload.locale) existing.locale = payload.locale;
      if (payload.pushToStartToken) {
        existing.pushToStartToken = payload.pushToStartToken;
      }
      existing.retiredAt = undefined;
      await existing.save();
      return { id: existing.id as string };
    }
    const created = await this.devices.create({
      app: payload.app,
      platform: payload.platform,
      token: payload.token,
      locale: payload.locale,
      pushToStartToken: payload.pushToStartToken,
      categories: payload.categories
        ? known(payload.categories)
        : ['arrivals' as PushCategory],
      consent: {},
    });
    return { id: created.id as string };
  }

  /**
   * Which categories this device wants.
   *
   * The moment of consent is written down for the ones that are marketing:
   * later, the thing that has to be producible is not "they are subscribed"
   * but "they said yes, then, to that sentence".
   */
  async setPreferences(
    payload: SetPreferencesPayload,
  ): Promise<{ categories: PushCategory[] }> {
    const device = await this.devices.findOne({ token: payload.token });
    if (!device) return { categories: [] };
    const wanted = known(payload.categories);
    const consent = { ...device.consent };
    for (const category of wanted) {
      if (!device.categories.includes(category)) {
        consent[category] = { at: new Date(), wording: CONSENT_WORDING };
      }
    }
    for (const category of device.categories) {
      if (!wanted.includes(category)) delete consent[category];
    }
    device.categories = wanted;
    device.consent = consent;
    await device.save();
    return { categories: wanted };
  }

  /**
   * Whether this device has agreed to hear about this kind of thing.
   *
   * A row that says nothing about a category has not agreed to it, and that is
   * the right answer for the two that are marketing: they are things somebody
   * at this end decided to send, and silence is a no.
   *
   * `arrivals` is not one of those, and a MISSING ROW is not a refusal. It is
   * a registration that did not land — no address yet, a gateway that was
   * down, an entitlement the app shipped without — and treating it as a no
   * meant the one notification this whole service exists for was dropped
   * without a word, while the countdown it belongs to kept updating perfectly.
   * Following a bus is asking to be told when it arrives; where there is no
   * row to say otherwise, that stands.
   */
  async accepts(token: string, category: PushCategory): Promise<boolean> {
    const device = await this.devices.findOne({ token, retiredAt: null });
    if (!device) {
      if (category !== 'arrivals') return false;
      this.logger.warn(
        'A followed departure has no device row; ringing for the arrival anyway.',
      );
      return true;
    }
    return device.categories.includes(category);
  }

  /** The reader turned everything off, or the app was deleted. */
  async forget(payload: ForgetDevicePayload): Promise<{ forgotten: boolean }> {
    const result = await this.devices.deleteOne({
      app: payload.app,
      token: payload.token,
    });
    return { forgotten: result.deletedCount > 0 };
  }

  /**
   * Apple or Google says this token is dead.
   *
   * Marked rather than deleted, for a day: a device that comes back with the
   * same token is recognised instead of counted as new, and a row that is
   * simply gone tells the next poll nothing about why it stopped.
   */
  async retire(token: string): Promise<void> {
    await this.devices.updateOne(
      { token },
      { $set: { retiredAt: new Date() } },
    );
  }
}
