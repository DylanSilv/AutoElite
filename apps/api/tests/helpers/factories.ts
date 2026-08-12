import type { UserRole } from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import { hashPassword } from '../../src/shared/password.js';
import { generateApiKey } from '../../src/shared/tokens.js';

/** Contraseña compartida por los usuarios de prueba. */
export const TEST_PASSWORD = 'contrasena-de-prueba';

let sequence = 0;
function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Deja la base vacía respetando el orden de las claves foráneas. */
export async function resetDatabase(): Promise<void> {
  await prisma.refreshToken.deleteMany();
  await prisma.apiClient.deleteMany();
  await prisma.user.deleteMany();
  await prisma.commerce.deleteMany();
}

export async function createCommerce(name = 'Pizzería de prueba') {
  return prisma.commerce.create({
    data: { name, slug: unique('comercio') },
  });
}

export async function createUser(options: {
  commerceId: number | null;
  role?: UserRole;
  email?: string;
  isActive?: boolean;
  password?: string;
}) {
  return prisma.user.create({
    data: {
      commerceId: options.commerceId,
      email: options.email ?? `${unique('usuario')}@test.local`,
      passwordHash: await hashPassword(options.password ?? TEST_PASSWORD),
      name: 'Usuario de prueba',
      role: options.role ?? 'STAFF',
      isActive: options.isActive ?? true,
    },
  });
}

export async function createApiClient(options: { commerceId: number; scopes?: string[] }) {
  const { key, keyHash } = generateApiKey();
  const client = await prisma.apiClient.create({
    data: {
      commerceId: options.commerceId,
      name: 'Integración de prueba',
      keyHash,
      scopes: options.scopes ?? ['catalog:read', 'orders:write'],
    },
  });
  return { client, key };
}

/**
 * Escenario base de los tests de aislamiento: dos comercios completos, cada uno
 * con su dueño, su personal y su credencial de máquina.
 */
export async function createTwoCommerces() {
  const [commerceA, commerceB] = await Promise.all([
    createCommerce('Pizzería A'),
    createCommerce('Pizzería B'),
  ]);

  const [ownerA, staffA, ownerB, staffB] = await Promise.all([
    createUser({ commerceId: commerceA.id, role: 'OWNER' }),
    createUser({ commerceId: commerceA.id, role: 'STAFF' }),
    createUser({ commerceId: commerceB.id, role: 'OWNER' }),
    createUser({ commerceId: commerceB.id, role: 'STAFF' }),
  ]);

  const [apiA, apiB] = await Promise.all([
    createApiClient({ commerceId: commerceA.id }),
    createApiClient({ commerceId: commerceB.id }),
  ]);

  return { commerceA, commerceB, ownerA, staffA, ownerB, staffB, apiA, apiB };
}
