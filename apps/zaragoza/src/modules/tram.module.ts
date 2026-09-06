import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { cacheTTL } from '../utils';
import { MongooseModule } from '@nestjs/mongoose';
import { TramController } from '../controllers/tram.controller';
import {
  TramAlert,
  TramAlertSchema,
  TramLine,
  TramLineSchema,
  TramStation,
  TramStationSchema,
} from '../schemas/tram.schema';
import { TramService } from '../services/tram.service';
import { alertReader, AlertReader } from '../alert-reader';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TramStation.name, schema: TramStationSchema },
      { name: TramLine.name, schema: TramLineSchema },
      { name: TramAlert.name, schema: TramAlertSchema },
    ]),
    HttpModule,
    CacheModule.register({ ttl: cacheTTL }),
  ],
  controllers: [TramController],
  providers: [
    TramService,
    // Without ANTHROPIC_API_KEY this reads nothing, and the alerts stay
    // exactly as the operator publishes them.
    { provide: AlertReader, useFactory: () => alertReader() },
  ],
  exports: [TramService],
})
export class TramModule {}
