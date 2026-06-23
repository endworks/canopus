import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { LoggingModule } from '@canopus/nest';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    LoggingModule,
    HttpModule,
    CacheModule.register({ ttl: 1000 * 60 * 60 * 6 }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
