import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BiziController } from '../controllers/bizi.controller';
import { BiziStation, BiziStationSchema } from '../schemas/bizi.schema';
import { BiziService } from '../services/bizi.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BiziStation.name, schema: BiziStationSchema }
    ]),
    HttpModule,
    CacheModule.register()
  ],
  controllers: [BiziController],
  providers: [BiziService],
  exports: [BiziService]
})
export class BiziModule {}
