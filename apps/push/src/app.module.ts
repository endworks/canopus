import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggingModule } from '@canopus/nest';
import { requireEnv, SERVICE_TOKENS, TCP_PORT } from '@canopus/shared';
import { PushController } from './push.controller';
import { ApnsService } from './apns/apns.service';
import { ClientKeys } from './services/client-keys';
import { DevicesService } from './services/devices.service';
import { FollowsService } from './services/follows.service';
import { ArrivalsService } from './services/arrivals.service';
import { Device, DeviceSchema } from './schemas/device.schema';
import { Follow, FollowSchema } from './schemas/follow.schema';

/**
 * The push service.
 *
 * It knows two things and does one. It knows which devices exist and what they
 * have agreed to hear about, and it knows which departures somebody is waiting
 * for; what it does is read those stops every fifteen seconds and tell each
 * phone the parts that changed.
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
    MongooseModule.forRoot(process.env.MONGODB_URI as string),
    MongooseModule.forFeature([
      { name: Device.name, schema: DeviceSchema },
      { name: Follow.name, schema: FollowSchema },
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
    DevicesService,
    FollowsService,
    ArrivalsService,
  ],
})
export class AppModule {}
