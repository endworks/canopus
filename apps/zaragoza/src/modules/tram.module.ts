import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TramController } from '../controllers/tram.controller';
import { TramStation, TramStationSchema } from '../schemas/tram.schema';
import { TramService } from '../services/tram.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TramStation.name, schema: TramStationSchema }
    ]),
    HttpModule,
    CacheModule.register()
  ],
  controllers: [TramController],
  providers: [TramService],
  exports: [TramService]
})
export class TramModule {}
