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
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const originAllowed = (origin: string | undefined) => {
    if (!origin) return true; // same-origin / curl / server-to-server
    if (origins.includes('*') || origins.includes(origin)) return true;
    try {
      const host = new URL(origin).hostname;
      // Local Vite apps
      if (host === 'localhost' || host === '127.0.0.1') return true;
      // DigitalOcean App Platform static/web apps (CRM + portal + future brands)
      if (host.endsWith('.ondigitalocean.app')) return true;
    } catch {
      return false;
    }
    return false;
  };

  app.enableCors({
    origin: (origin, callback) => {
      if (originAllowed(origin)) callback(null, true);
      else callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
  });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Crmto API running on http://localhost:${port}`);
  console.log(`CORS allowlist: ${origins.join(', ')} (+ localhost + *.ondigitalocean.app)`);
}
bootstrap();
