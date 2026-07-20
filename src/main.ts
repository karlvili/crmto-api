import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173', credentials: true });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Crmto API running on http://localhost:${port}`);
}
bootstrap();
