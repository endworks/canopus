import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggingModule } from '@canopus/nest';
import { requireEnv, SERVICE_TOKENS, TCP_PORT } from '@canopus/shared';
import { PushController } from './push.controller';
import { ApnsService } from './apns/apns.service';
import { FcmService } from './fcm/fcm.service';
import { ClientKeys } from './services/client-keys';
import { DevicesService } from './services/devices.service';
import { FollowsService } from './services/follows.service';
import { ArrivalsService } from './services/arrivals.service';
import { Device, DeviceSchema } from './schemas/device.schema';
import { Follow, FollowSchema } from './schemas/follow.schema';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';

/**
 * The push service.
 *
 * It knows three things and does one. Which devices exist and what they have
 * agreed to hear about; which departures are being watched — one row per bus,
 * however many people are waiting for it; and which phone is waiting behind
 * which. What it does is read those stops every half a minute and tell every
 * phone behind a bus the parts that changed, in the same words at the same
 * moment.
 *
 * The transit service is a client here rather than a dependency: this asks it
 * for a board over the same wire the gateway does, through its own ten-second
 * cache, so a stop with a hundred followers is still one request.
 */
@Module({
  imports: [
    LoggingModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) =>
        requireEnv(config, ['MONGODB_URI', 'ZARAGOZA_SERVICE_HOST']),
    }),
    // Its own database, named after itself the way `zine` and `zaragoza` are.
    // Without this it takes whatever the connection string defaults to, which
    // is `test` — so a registry of real devices and the departures people are
    // waiting for has been sitting in the database nobody is supposed to keep
    // anything in.
    //
    // Nothing is migrated and nothing needs to be: a device re-registers the
    // next time the app comes forward, and no follow outlives the hour. What
    // is left behind in `test` is two collections that will never be read
    // again and can be dropped by hand.
    MongooseModule.forRoot(process.env.MONGODB_URI as string, {
      dbName: 'push',
    }),
    MongooseModule.forFeature([
      { name: Device.name, schema: DeviceSchema },
      { name: Follow.name, schema: FollowSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    ScheduleModule.forRoot(),
    ClientsModule.register([
      {
        name: SERVICE_TOKENS.zaragoza,
        transport: Transport.TCP,
        options: {
          host: process.env[`${SERVICE_TOKENS.zaragoza}_HOST`],
          port: TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [PushController],
  providers: [
    ClientKeys,
    ApnsService,
    FcmService,
    DevicesService,
    FollowsService,
    ArrivalsService,
  ],
})
export class AppModule {}
