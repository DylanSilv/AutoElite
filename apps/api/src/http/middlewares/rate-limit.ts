import type { ApiErrorBody } from '@autoelite/shared';
import type { Request, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { isTest } from '../../config/env.js';

function limitHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'RATE_LIMITED',
      message: 'Demasiados intentos. Probá de nuevo en unos minutos.',
      requestId: req.requestId,
    },
  };
  res.status(429).json(body);
}

const base: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
  // Los tests no deben fallar por el límite de un test anterior.
  skip: () => isTest,
};

/** El login es el objetivo obvio de la fuerza bruta: límite agresivo por IP. */
export const loginRateLimit = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

/** Límite general, pensado para que n8n y el agente no saturen la API. */
export const apiRateLimit = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: (req: Request) => req.actor?.publicId ?? req.ip ?? 'anonymous',
});
