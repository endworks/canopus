import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { cacheTTL } from '../utils';
import { MongooseModule } from '@nestjs/mongoose';
import { TramController } from '../controllers/tram.controller';
import { TramStation, TramStationSchema } from '../schemas/tram.schema';
import { TramService } from '../services/tram.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TramStation.name, schema: TramStationSchema },
    ]),
    HttpModule,
    CacheModule.register({ ttl: cacheTTL }),
  ],
  controllers: [TramController],
  providers: [TramService],
  exports: [TramService],
})
export class TramModule {}
