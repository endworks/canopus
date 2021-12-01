import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ZaragozaController } from './controllers/zaragoza.controller';
import { ZineController } from './controllers/zine.controller';
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
    ]),
  ],
  controllers: [ZaragozaController, ZineController],
  providers: [ZaragozaService, ZineService],
})
export class AppModule {}
