import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { requestId } from './middlewares/request-id.js';
import { requestLogger } from './middlewares/request-logger.js';
import { apiRouter } from './router.js';

export function createApp(): Express {
  const app = express();

  // Detrás de un proxy/balanceador, para que req.ip y el rate limit vean la IP
  // real del cliente y no la del proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      // Necesario para que el panel mande la cookie del refresh token.
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestId);
  app.use(requestLogger);

  // Fuera de /api/v1: el chequeo de salud no debe cambiar al versionar la API.
  app.use(healthRouter);

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
