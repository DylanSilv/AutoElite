import type { ApiScope, UserRole } from '@autoelite/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError } from '../../shared/errors.js';
import { getActor } from '../context.js';

/**
 * Restringe una ruta a determinados roles humanos.
 *
 * Una API key nunca pasa este control: las máquinas se autorizan por scopes.
 * Mezclar ambos mundos es lo que termina dándole al agente de IA permisos que
 * nadie le quiso dar.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.kind !== 'user') {
        throw new ForbiddenError('FORBIDDEN', 'Esta operación requiere un usuario, no una API key');
      }
      if (!roles.includes(actor.role)) {
        throw new ForbiddenError('FORBIDDEN', 'No tenés permisos para esta operación', {
          required: roles,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Restringe una ruta a credenciales de máquina con los scopes indicados. */
export function requireScope(...scopes: ApiScope[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      // Un usuario humano con rol suficiente también puede usar estas rutas.
      if (actor.kind === 'user') return next();

      const missing = scopes.filter((scope) => !actor.scopes.includes(scope));
      if (missing.length > 0) {
        throw new ForbiddenError('INSUFFICIENT_SCOPE', 'La API key no tiene los permisos necesarios', {
          missing,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Rechaza a las API keys en rutas pensadas solo para el panel. */
export const requireUser: RequestHandler = (req, _res, next) => {
  try {
    const actor = getActor(req);
    if (actor.kind !== 'user') {
      throw new ForbiddenError('FORBIDDEN', 'Esta operación requiere un usuario, no una API key');
    }
    next();
  } catch (err) {
    next(err);
  }
};
