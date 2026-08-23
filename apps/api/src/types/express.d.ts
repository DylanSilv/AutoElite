import type { Actor } from '../http/context.js';

declare global {
  namespace Express {
    interface Request {
      /** Identificador del request, presente en logs y en toda respuesta de error. */
      requestId: string;
      /** Lo setea el middleware de autenticación. */
      actor?: Actor;
    }
  }
}

export {};
