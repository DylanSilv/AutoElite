import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Un identificador por request, devuelto en cada error y presente en los logs.
 *
 * Cuando el que llame sea n8n o el agente de IA, este es el hilo que permite
 * reconstruir qué pasó sin adivinar.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && incoming.length <= 100 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
