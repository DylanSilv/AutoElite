import type { UserDto } from '@autoelite/shared';
import type { User } from '@prisma/client';

/**
 * Entidad de Prisma → DTO de la API.
 *
 * Pasar por acá y no serializar la entidad directa es lo que garantiza que un
 * `passwordHash` nunca se escape en una respuesta al agregar una columna.
 */
export function toUserDto(user: User): UserDto {
  return {
    id: user.publicId,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
