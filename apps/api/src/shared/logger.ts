import pino from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  // En producción, JSON plano para que lo consuma el agregador de logs.
  transport: isProduction || isTest ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'password',
      'currentPassword',
      'newPassword',
      'accessToken',
      'refreshToken',
      'key',
    ],
    censor: '[redactado]',
  },
});

export type Logger = typeof logger;
