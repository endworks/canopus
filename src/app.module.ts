import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { RAEController } from './controllers/rae.controller';
import { ZaragozaController } from './controllers/zaragoza.controller';
import { ZineController } from './controllers/zine.controller';
import { RAEService } from './services/rae.service';
import { ZaragozaService } from './services/zaragoza.service';
import { ZineService } from './services/zine.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: process.env.NODE_ENV
        ? `.env.${process.env.NODE_ENV}`
        : '.env',
    }),
    ClientsModule.register([
      {
        name: 'ZARAGOZA_SERVICE',
        transport: Transport.TCP,
        options: {
          host: process.env.ZARAGOZA_SERVICE_HOST,
          port: 8877,
        },
      },
      {
        name: 'ZINE_SERVICE',
        transport: Transport.TCP,
        options: {
          host: process.env.ZINE_SERVICE_HOST,
          port: 8878,
        },
      },
      {
        name: 'RAE_SERVICE',
        transport: Transport.TCP,
        options: {
          host: process.env.RAE_SERVICE_HOST,
          port: 8879,
        },
      },
    ]),
  ],
  controllers: [ZaragozaController, ZineController, RAEController],
  providers: [ZaragozaService, ZineService, RAEService],
})
export class AppModule {}
