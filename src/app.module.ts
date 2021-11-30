import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ZaragozaController } from './controllers/zaragoza.controller';
import { ZineController } from './controllers/zine.controller';
import { ZaragozaService } from './services/zaragoza.service';
import { ZineService } from './services/zine.service';

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
      {
        name: 'ZINE_SERVICE',
        transport: Transport.TCP,
        options: {
          host: 'canopus-zine',
          port: 8878,
        },
      },
    ]),
  ],
  controllers: [ZaragozaController, ZineController],
  providers: [ZaragozaService, ZineService],
})
export class AppModule {}
