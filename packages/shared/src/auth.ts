import { z } from 'zod';

/**
 * Roles dentro de un comercio, del más al menos permisivo.
 *
 * PLATFORM_ADMIN es transversal a la plataforma y no pertenece a ningún
 * comercio; el resto siempre está atado a uno.
 */
export const USER_ROLES = ['PLATFORM_ADMIN', 'OWNER', 'MANAGER', 'STAFF'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Permisos de las credenciales de máquina (n8n, agente de IA).
 *
 * Se declaran por separado de los roles humanos: el agente nunca debe usar las
 * credenciales de un empleado, para que la auditoría siga siendo cierta y
 * revocarle el acceso no implique cambiarle la contraseña a una persona.
 */
export const API_SCOPES = [
  'catalog:read',
  'customers:read',
  'customers:write',
  'orders:read',
  'orders:write',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(200);

export const loginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  commerce: { id: string; name: string; timezone: string; currency: string } | null;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}
