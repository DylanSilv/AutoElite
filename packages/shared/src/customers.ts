import { z } from 'zod';

/**
 * Teléfono argentino tolerante a lo que tipea el operador.
 *
 * La normalización a E.164 la hace el backend: acá sólo se valida que haya
 * suficientes dígitos como para ser un teléfono.
 */
export const phoneSchema = z
  .string()
  .min(6)
  .max(30)
  .trim()
  .refine((v) => (v.match(/\d/g) ?? []).length >= 8, {
    message: 'El teléfono necesita al menos 8 dígitos',
  });

export const addressInputSchema = z.object({
  id: z.string().optional(),
  label: z.string().max(40).trim().optional(),
  street: z.string().min(1).max(160).trim(),
  number: z.string().max(20).trim().optional(),
  apartment: z.string().max(40).trim().optional(),
  neighborhood: z.string().max(80).trim().optional(),
  city: z.string().max(80).trim().optional(),
  reference: z.string().max(500).trim().optional(),
  deliveryZoneId: z.string().optional(),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  phone: phoneSchema,
  notes: z.string().max(1000).trim().optional(),
  addresses: z.array(addressInputSchema).default([]),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay campos para actualizar' });
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customerFiltersSchema = z.object({
  search: z.string().max(120).trim().optional(),
  phone: z.string().max(30).trim().optional(),
});
export type CustomerFilters = z.infer<typeof customerFiltersSchema>;

export interface AddressDto {
  id: string;
  label: string | null;
  street: string;
  number: string | null;
  apartment: string | null;
  neighborhood: string | null;
  city: string | null;
  reference: string | null;
  deliveryZone: { id: string; name: string; feeCents: number } | null;
  isDefault: boolean;
}

export interface CustomerDto {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  ordersCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
  isActive: boolean;
  addresses: AddressDto[];
}

// ---------- Configuración operativa ----------

export const createDeliveryZoneSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  feeCents: z.number().int().min(0).max(100_000_000),
  estimatedMin: z.number().int().min(0).max(600).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type CreateDeliveryZoneInput = z.infer<typeof createDeliveryZoneSchema>;

export const updateDeliveryZoneSchema = createDeliveryZoneSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay campos para actualizar' });
export type UpdateDeliveryZoneInput = z.infer<typeof updateDeliveryZoneSchema>;

export interface DeliveryZoneDto {
  id: string;
  name: string;
  feeCents: number;
  estimatedMin: number | null;
  isActive: boolean;
  sortOrder: number;
}

export const createPaymentMethodSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  code: z
    .string()
    .min(1)
    .max(30)
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]+$/, 'Sólo letras, números y guión bajo'),
  requiresChangeFor: z.boolean().default(false),
  /** Exige que el cliente pague antes de que el pedido llegue a la cocina. */
  requiresPrepayment: z.boolean().default(false),
  /** Modalidades donde se puede usar. Vacío o ausente = todas. */
  allowedOrderTypes: z.array(z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY'])).optional(),
  /** Alias, cuenta y titular que el agente le manda al cliente. */
  instructions: z.string().max(1000).trim().optional(),
  qrImageUrl: z.string().url().max(500).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;

export const updatePaymentMethodSchema = createPaymentMethodSchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay campos para actualizar' });
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

export interface PaymentMethodDto {
  id: string;
  name: string;
  code: string;
  requiresChangeFor: boolean;
  requiresPrepayment: boolean;
  allowedOrderTypes: string[] | null;
  instructions: string | null;
  qrImageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
}
