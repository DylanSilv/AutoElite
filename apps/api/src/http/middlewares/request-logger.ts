import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../shared/logger.js';

/** Una línea por request, con duración y quién lo hizo. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const actor = req.actor
      ? { kind: req.actor.kind, id: req.actor.publicId, commerceId: req.actor.commerceId }
      : undefined;

    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.route?.path ?? req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        actor,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode}`,
    );
  });

  next();
}
