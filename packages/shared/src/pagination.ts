import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Paginación por cursor, no por offset.
 *
 * En un panel de pedidos entran filas nuevas mientras el operador scrollea; con
 * `offset` eso duplica o saltea registros. El cursor es opaco a propósito para
 * poder cambiar la implementación sin romper a los clientes.
 */
export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
