import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { cacheTTL } from '../utils';
import { MongooseModule } from '@nestjs/mongoose';
import { BusController } from '../controllers/bus.controller';
import {
  BusAlert,
  BusAlertSchema,
  BusLine,
  BusLineSchema,
  BusStation,
  BusStationSchema,
} from '../schemas/bus.schema';
import { BusService } from '../services/bus.service';
import { alertReader, AlertReader } from '../alert-reader';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BusStation.name, schema: BusStationSchema },
      { name: BusLine.name, schema: BusLineSchema },
      { name: BusAlert.name, schema: BusAlertSchema },
    ]),
    HttpModule,
    CacheModule.register({ ttl: cacheTTL }),
  ],
  controllers: [BusController],
  providers: [
    BusService,
    // Without ANTHROPIC_API_KEY this reads nothing, and the alerts stay
    // exactly as the listing publishes them.
    { provide: AlertReader, useFactory: () => alertReader() },
  ],
  exports: [BusService],
})
export class BusModule {}
