import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  // Disable default body parser so we can raise the size limit for lead imports
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));
  app.use(cookieParser());
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5175,http://localhost:5180')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length === 1 ? origins[0] : origins,
    credentials: true,
  });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Crmto API running on http://localhost:${port}`);
  console.log(`CORS origins: ${origins.join(', ')}`);
}
bootstrap();
