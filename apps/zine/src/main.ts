import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Transport } from '@nestjs/microservices';
import { TCP_PORT } from '@canopus/shared';
import { RpcErrorFilter } from '@canopus/nest';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: TCP_PORT,
    },
  });
  app.useGlobalFilters(new RpcErrorFilter());
  app.listen();
}
bootstrap();
