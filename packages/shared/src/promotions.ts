import { z } from 'zod';

/**
 * Promociones.
 *
 * Son texto que el comercio escribe y el asistente transmite, no un motor de
 * descuentos: ver el comentario del modelo en schema.prisma.
 */

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .optional()
  .describe('0 = domingo. Vacío significa todos los días.');

export const createPromotionSchema = z.object({
  title: z.string().min(1).max(120).trim(),
  description: z.string().min(1).max(2000).trim(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  weekdays: weekdaysSchema,
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

export const updatePromotionSchema = createPromotionSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay campos para actualizar' });
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;

export interface PromotionDto {
  id: string;
  title: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  weekdays: number[];
  isActive: boolean;
  sortOrder: number;
  /** Si aplica hoy, considerando vigencia y días de la semana. */
  activeToday: boolean;
}

export const WEEKDAY_LABELS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;
