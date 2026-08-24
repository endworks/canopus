import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { cacheTTL } from '../utils';
import { MongooseModule } from '@nestjs/mongoose';
import { BusController } from '../controllers/bus.controller';
import {
  BusLine,
  BusLineSchema,
  BusStation,
  BusStationSchema,
} from '../schemas/bus.schema';
import { BusService } from '../services/bus.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BusStation.name, schema: BusStationSchema },
      { name: BusLine.name, schema: BusLineSchema },
    ]),
    HttpModule,
    CacheModule.register({ ttl: cacheTTL }),
  ],
  controllers: [BusController],
  providers: [BusService],
  exports: [BusService],
})
export class BusModule {}
