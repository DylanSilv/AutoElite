import { z } from 'zod';

const name = z.string().min(1).max(120).trim();
const priceCents = z.number().int().min(0).max(100_000_000);

// ---------- Categorías ----------

export const createCategorySchema = z.object({
  name,
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay campos para actualizar' });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export interface CategoryDto {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productsCount?: number;
}

// ---------- Variantes ----------

export const variantInputSchema = z.object({
  /** Presente al editar una variante existente; ausente al crearla. */
  id: z.string().optional(),
  name: z.string().min(1).max(60).trim(),
  priceCents,
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export interface VariantDto {
  id: string;
  name: string;
  priceCents: number;
  isAvailable: boolean;
  sortOrder: number;
}

// ---------- Productos ----------

export const createProductSchema = z.object({
  categoryId: z.string().min(1),
  name,
  description: z.string().max(1000).trim().optional(),
  imageUrl: z.string().url().max(500).optional(),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  /** Todo producto tiene al menos una variante, aunque se llame "Única". */
  variants: z.array(variantInputSchema).min(1, 'El producto necesita al menos una variante'),
  modifierGroupIds: z.array(z.string()).default([]),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay campos para actualizar' });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productFiltersSchema = z.object({
  search: z.string().max(120).trim().optional(),
  categoryId: z.string().optional(),
  onlyAvailable: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ProductFilters = z.infer<typeof productFiltersSchema>;

export interface ProductDto {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
  category: { id: string; name: string };
  variants: VariantDto[];
  modifierGroups: ModifierGroupDto[];
}

// ---------- Modificadores ----------

export const modifierOptionInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80).trim(),
  priceDeltaCents: z.number().int().min(-100_000_000).max(100_000_000).default(0),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type ModifierOptionInput = z.infer<typeof modifierOptionInputSchema>;

export const createModifierGroupSchema = z
  .object({
    name,
    minSelect: z.number().int().min(0).max(20).default(0),
    maxSelect: z.number().int().min(1).max(20).default(1),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    options: z.array(modifierOptionInputSchema).min(1),
  })
  .refine((v) => v.maxSelect >= v.minSelect, {
    message: 'El máximo no puede ser menor que el mínimo',
    path: ['maxSelect'],
  });
export type CreateModifierGroupInput = z.infer<typeof createModifierGroupSchema>;

export interface ModifierOptionDto {
  id: string;
  name: string;
  priceDeltaCents: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface ModifierGroupDto {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  sortOrder: number;
  options: ModifierOptionDto[];
}
