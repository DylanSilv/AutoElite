import type { User, UserRole } from '@prisma/client';
import type { TenantClient } from '../../db/tenant.js';

/**
 * Acceso a datos. No decide nada: consulta y persiste.
 *
 * Recibe siempre el cliente acotado al comercio, así ninguna consulta de este
 * archivo puede ver usuarios de otro comercio aunque se olvide el filtro.
 */

export function listUsers(db: TenantClient, limit: number, cursorId?: number): Promise<User[]> {
  return db.user.findMany({
    // Se pide uno de más para saber si hay página siguiente.
    take: limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    orderBy: { id: 'asc' },
  });
}

export function findUserByPublicId(db: TenantClient, publicId: string): Promise<User | null> {
  return db.user.findFirst({ where: { publicId } });
}

export function findUserByEmail(db: TenantClient, email: string): Promise<User | null> {
  return db.user.findFirst({ where: { email } });
}

export function createUser(
  db: TenantClient,
  data: { email: string; passwordHash: string; name: string; role: UserRole },
): Promise<User> {
  return db.user.create({ data });
}

export function updateUser(
  db: TenantClient,
  id: number,
  data: Partial<Pick<User, 'name' | 'role' | 'isActive'>>,
): Promise<User> {
  return db.user.update({ where: { id }, data });
}
