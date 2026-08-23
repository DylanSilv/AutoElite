import { z } from 'zod';
import { API_SCOPES, USER_ROLES, passwordSchema, type UserRole } from './auth.js';

/** Roles asignables desde el panel: PLATFORM_ADMIN no se otorga por API. */
export const ASSIGNABLE_ROLES = USER_ROLES.filter((r) => r !== 'PLATFORM_ADMIN') as Exclude<
  UserRole,
  'PLATFORM_ADMIN'
>[];

export const createUserSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: passwordSchema,
  name: z.string().min(1).max(120).trim(),
  role: z.enum(['OWNER', 'MANAGER', 'STAFF']).default('STAFF'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(120).trim().optional(),
    role: z.enum(['OWNER', 'MANAGER', 'STAFF']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay campos para actualizar' });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const createApiClientSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});
export type CreateApiClientInput = z.infer<typeof createApiClientSchema>;

export interface ApiClientDto {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** La clave en texto plano se devuelve una sola vez, al crearla. */
export interface ApiClientWithSecretDto extends ApiClientDto {
  key: string;
}
