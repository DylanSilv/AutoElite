import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { healthRouter } from '../modules/health/health.routes.js';
import {
  WHATSAPP_WEBHOOK_PATH,
  whatsappWebhookRouter,
} from '../modules/agent/whatsapp.webhook.js';
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
  app.use(
    express.json({
      limit: '1mb',
      // El webhook de WhatsApp se firma sobre los bytes exactos del cuerpo: si
      // se verificara sobre el JSON re-serializado, cualquier diferencia de
      // formato invalidaría firmas legítimas.
      verify: (req, _res, buf) => {
        if (req.url?.startsWith(WHATSAPP_WEBHOOK_PATH)) {
          (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
        }
      },
    }),
  );
  app.use(cookieParser());
  app.use(requestId);
  app.use(requestLogger);

  // Fuera de /api/v1: el chequeo de salud no debe cambiar al versionar la API.
  app.use(healthRouter);
  // Fuera de /api/v1 y sin autenticación nuestra: quien llama es Meta, y se
  // verifica por firma (ver whatsapp.webhook.ts).
  app.use(whatsappWebhookRouter);

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
