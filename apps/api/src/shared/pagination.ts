import type { Page } from '@autoelite/shared';
import { ValidationError } from './errors.js';

/**
 * El cursor es opaco para el cliente: hoy codifica un id interno, mañana puede
 * codificar `(updatedAt, id)` sin romper a nadie.
 */
export function encodeCursor(id: number): string {
  return Buffer.from(String(id), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): number {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Cursor inválido');
  return id;
}

/**
 * Se consulta `limit + 1` para saber si hay página siguiente sin hacer un
 * `count` aparte, que sobre tablas grandes cuesta más que la consulta misma.
 */
export function buildPage<T extends { id: number }, D>(
  rows: T[],
  limit: number,
  toDto: (row: T) => D,
): Page<D> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    data: page.map(toDto),
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
  };
}
