import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SwaggerTheme, SwaggerThemeNameEnum } from 'swagger-themes';
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
    customCss: new SwaggerTheme().getBuffer(SwaggerThemeNameEnum.ONE_DARK),
    customSiteTitle: `Canopus API (${pkg.version})`,
    swaggerOptions: {
      // Services follow addTag order; routes follow controller order. The only
      // override: '/update' actions are shown LAST in their block. They must be
      // REGISTERED before '/:id' (else the param route swallows '/update'), so we
      // only reorder them for display. The sorter is self-contained because
      // swagger-ui runs it client-side.
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      persistAuthorization: true,
      operationsSorter: (
        a: { get(key: string): string },
        b: { get(key: string): string },
      ) => {
        const order = [
          '/zgz/bus/stations',
          '/zgz/bus/stations/{id}',
          '/zgz/bus/lines',
          '/zgz/bus/lines/{id}',
          '/zgz/bus/lines/update',
          '/zgz/tram/stations',
          '/zgz/tram/stations/{id}',
          '/zgz/bizi/stations',
          '/zgz/bizi/stations/{id}',
          '/zgz/bizi/stations/update',
        ];
        const rank = (op: { get(x: string): string }) => {
          const i = order.indexOf(op.get('path'));
          return i === -1 ? 999 : i;
        };
        return rank(a) - rank(b);
      },
    },
  });
  await app.listen(3000);
}
bootstrap();
