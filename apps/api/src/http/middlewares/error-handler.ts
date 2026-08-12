import type { ApiErrorBody } from '@autoelite/shared';
import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

/** Ruta inexistente: se convierte en error de dominio y sigue el camino común. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError('La ruta no existe'));
}

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: violación de índice único. P2025: registro no encontrado.
    if (err.code === 'P2002') {
      return new AppError('CONFLICT', 409, 'El recurso ya existe', {
        fields: (err.meta?.target as string[] | undefined) ?? undefined,
      });
    }
    if (err.code === 'P2025') {
      return new NotFoundError('Recurso no encontrado');
    }
  }

  return null;
}

/**
 * Único lugar del backend que traduce errores a códigos HTTP.
 *
 * Los errores no controlados se loguean completos y se responden como 500
 * genérico: nada de filtrar stack traces ni detalles internos al cliente.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = toAppError(err);

  if (appError) {
    if (appError.status >= 500) {
      logger.error({ err, requestId: req.requestId }, appError.message);
    } else {
      logger.debug({ requestId: req.requestId, code: appError.code }, appError.message);
    }

    const body: ApiErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details === undefined ? {} : { details: appError.details }),
        requestId: req.requestId,
      },
    };
    res.status(appError.status).json(body);
    return;
  }

  logger.error({ err, requestId: req.requestId }, 'Error no controlado');

  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error inesperado',
      requestId: req.requestId,
    },
  };
  res.status(500).json(body);
}
