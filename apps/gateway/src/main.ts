import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RpcResponseInterceptor } from '@canopus/nest';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

// Read package metadata from disk (modern npm no longer exposes most
// npm_package_* env vars, which left the Swagger contact/license blank).
const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
) as {
  version: string;
  description: string;
  homepage: string;
  license: string;
  author: { name: string; email: string; url: string };
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors();
  app.useGlobalInterceptors(new RpcResponseInterceptor());

  const config = new DocumentBuilder()
    .setTitle('Canopus API')
    .setDescription(pkg.description)
    .setVersion(pkg.version)
    .setContact(pkg.author.name, pkg.author.url, pkg.author.email)
    .setLicense(pkg.license, `${pkg.homepage}/blob/main/LICENSE`)
    .addTag(
      'Zaragoza',
      'Public transport — bus, tram and Bizi bike stations and lines',
    )
    .addTag('Zine, cinemas and movies', 'Cinema listings and movie details')
    .addTag('RAE definitions', 'Spanish dictionary (RAE) lookups')
    .addTag('Twitter downloader', 'Media URLs extracted from tweets')
    .addTag('Health', 'Service readiness')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/', app, document, {
    customSiteTitle: `Canopus API (${pkg.version})`,
    swaggerOptions: {
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      persistAuthorization: true,
    },
  });
  await app.listen(3000);
}
bootstrap();
