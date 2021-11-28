import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ZaragozaController } from './controllers/zaragoza.controller';
import { ZaragozaService } from './services/zaragoza.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'ZARAGOZA_SERVICE',
        transport: Transport.TCP,
        options: {
          host: '0.0.0.0',
          port: 8877,
        },
      },
    ]),
  ],
  controllers: [ZaragozaController],
  providers: [ZaragozaService],
})
export class AppModule {}
