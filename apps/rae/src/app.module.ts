import { HttpModule } from '@nestjs/axios';
import { CacheModule, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { cacheMaxSize, cacheTTL } from './utils';

@Module({
  imports: [
    HttpModule,
    CacheModule.register({
      ttl: cacheTTL,
      max: cacheMaxSize,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
