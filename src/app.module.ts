import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AppController } from './app.controller';
import { ZaragozaService } from './zaragoza.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'ZARAGOZA_SERVICE',
        transport: Transport.TCP,
        options: {
          host: 'canopus-zaragoza',
          port: 8877,
        },
      },
    ]),
  ],
  controllers: [AppController],
  providers: [ZaragozaService],
})
export class AppModule {}
