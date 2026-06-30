import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Все REST-маршруты монтируются под /api
  app.setGlobalPrefix('api');

  // CORS для Vite dev server (5173) и production preview (4173)
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:4173'],
    credentials: true,
  });

  // Глобальный ValidationPipe:
  // transform — авто-преобразование типов (строка → число и т.д.)
  // whitelist — удаление полей, не указанных в DTO
  // forbidNonWhitelisted — ошибка при наличии лишних полей
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Единый фильтр ошибок — любой Exception приводится к { statusCode, message, error }
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger / OpenAPI документация
  const config = new DocumentBuilder()
    .setTitle('Async URL Checker')
    .setDescription('Сервис асинхронной проверки работоспособности URL')
    .setVersion('1.0.0')
    .addTag('jobs')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
