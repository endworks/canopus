import { HttpModule, HttpService } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { cacheTTL } from '../utils';
import { MongooseModule } from '@nestjs/mongoose';
import { BiziController } from '../controllers/bizi.controller';
import { BiziStation, BiziStationSchema } from '../schemas/bizi.schema';
import { BiziService } from '../services/bizi.service';
import { biziGbfs, GbfsClient } from '../gbfs';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BiziStation.name, schema: BiziStationSchema },
    ]),
    HttpModule,
    CacheModule.register({ ttl: cacheTTL }),
  ],
  controllers: [BiziController],
  providers: [
    BiziService,
    {
      // Unconfigured is a client that says it is not there, not an absent
      // provider: the service asks it whether it is worth asking, which is one
      // branch rather than an optional dependency at every call site.
      provide: GbfsClient,
      useFactory: (http: HttpService) => biziGbfs(http),
      inject: [HttpService],
    },
  ],
  exports: [BiziService],
})
export class BiziModule {}
