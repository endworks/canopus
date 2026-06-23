import { CacheModule, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    CacheModule.register({
      ttl: 60 * 60 * 6,
      max: 60 * 60 * 24 * 7,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
