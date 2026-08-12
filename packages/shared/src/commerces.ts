import { z } from 'zod';

/** "HH:mm" en hora local del comercio. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato esperado HH:mm');

export const updateCommerceSchema = z
  .object({
    name: z.string().min(1).max(160).trim().optional(),
    phone: z.string().max(40).trim().optional(),
    address: z.string().max(255).trim().optional(),
    timezone: z.string().min(1).max(64).optional(),
    /**
     * Hora de corte del día operativo. Una pizzería que cierra a la 1 AM cuenta
     * el pedido de las 00:40 dentro del día anterior; sin esto, el dashboard no
     * coincide con la caja.
     */
    businessDayCutoff: timeOfDaySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay campos para actualizar' });
export type UpdateCommerceInput = z.infer<typeof updateCommerceSchema>;

export interface CommerceDto {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  businessDayCutoff: string;
  isActive: boolean;
}
