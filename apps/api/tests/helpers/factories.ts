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
  await prisma.conversationMessage.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.outboundMessage.deleteMany();
  await prisma.paymentProof.deleteMany();
  await prisma.orderItemModifier.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.orderStatusHistory.deleteMany();
  await prisma.order.deleteMany();
  await prisma.$executeRaw`DELETE FROM OrderCounter`;
  await prisma.customerAddress.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.productModifierGroup.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.modifierOption.deleteMany();
  await prisma.modifierGroup.deleteMany();
  await prisma.category.deleteMany();
  await prisma.deliveryZone.deleteMany();
  await prisma.paymentMethod.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.apiClient.deleteMany();
  await prisma.user.deleteMany();
  await prisma.commerce.deleteMany();
}

/**
 * Catálogo mínimo pero completo: una pizza con tres tamaños, una bebida, un
 * grupo de extras, una zona de envío y un método de pago.
 */
export async function createCatalog(commerceId: number) {
  const category = await prisma.category.create({
    data: { commerceId, name: `Pizzas ${unique('cat')}` },
  });

  const extras = await prisma.modifierGroup.create({
    data: {
      commerceId,
      name: `Extras ${unique('mod')}`,
      minSelect: 0,
      maxSelect: 3,
      options: {
        create: [
          { commerceId, name: 'Huevo', priceDeltaCents: 90_000 },
          { commerceId, name: 'Jamón', priceDeltaCents: 150_000 },
        ],
      },
    },
    include: { options: true },
  });

  const pizza = await prisma.product.create({
    data: {
      commerceId,
      categoryId: category.id,
      name: 'Muzzarella',
      variants: {
        create: [
          { commerceId, name: 'Chica', priceCents: 850_000, sortOrder: 0 },
          { commerceId, name: 'Grande', priceCents: 1_450_000, sortOrder: 1 },
        ],
      },
      modifierGroups: { create: { modifierGroupId: extras.id } },
    },
    include: { variants: true },
  });

  const drink = await prisma.product.create({
    data: {
      commerceId,
      categoryId: category.id,
      name: 'Coca-Cola 1,5L',
      variants: { create: { commerceId, name: 'Única', priceCents: 350_000 } },
    },
    include: { variants: true },
  });

  const zone = await prisma.deliveryZone.create({
    data: { commerceId, name: `Centro ${unique('zona')}`, feeCents: 150_000, estimatedMin: 25 },
  });

  const paymentMethod = await prisma.paymentMethod.create({
    data: { commerceId, name: 'Efectivo', code: `CASH_${unique('pm')}`, requiresChangeFor: true },
  });

  return {
    category,
    extras,
    pizza,
    pizzaChica: pizza.variants.find((v) => v.name === 'Chica')!,
    pizzaGrande: pizza.variants.find((v) => v.name === 'Grande')!,
    drink,
    drinkVariant: drink.variants[0]!,
    zone,
    paymentMethod,
  };
}

export async function createCustomer(options: { commerceId: number; phone?: string; name?: string }) {
  return prisma.customer.create({
    data: {
      commerceId: options.commerceId,
      name: options.name ?? 'Cliente de prueba',
      phoneE164: options.phone ?? `+5989${String(Math.floor(random8()))}`,
      phoneRaw: options.phone ?? null,
    },
  });
}

function random8(): number {
  sequence += 1;
  return 10_000_000 + sequence;
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
