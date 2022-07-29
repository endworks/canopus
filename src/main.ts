import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const config = new DocumentBuilder()
    .setTitle(process.env.npm_package_name)
    .setDescription(process.env.npm_package_description)
    .setVersion(process.env.npm_package_version)
    .setLicense(
      process.env.npm_package_license,
      `${process.env.npm_package_homepage}/blob/main/LICENSE`,
    )
    .setContact(
      process.env.npm_package_author_name,
      process.env.npm_package_homepage,
      process.env.npm_package_author_email,
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/', app, document, {
    customSiteTitle: `${process.env.npm_package_name} (${process.env.npm_package_version})`,
    uiConfig: {
      defaultModelsExpandDepth: -1,
      filter: true,
      syntaxHighlight: {
        activate: true,
        theme: 'monokai',
      },
      deepLinking: true,
    },
  });
  await app.listen(3000);
}
bootstrap();
