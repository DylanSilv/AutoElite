import type {
  AddressDto,
  AddressInput,
  CreateCustomerInput,
  CustomerDto,
  CustomerFilters,
  Page,
  UpdateCustomerInput,
} from '@autoelite/shared';
import { Prisma, type Customer, type CustomerAddress, type DeliveryZone } from '@prisma/client';
import type { TenantContext } from '../../http/context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { buildPage, decodeCursor } from '../../shared/pagination.js';
import {
  InvalidPhoneError,
  normalizePhone,
  tryNormalizePhone,
  type CountryCode,
} from '../../shared/phone.js';

type CustomerWithRelations = Customer & {
  addresses: (CustomerAddress & { deliveryZone: DeliveryZone | null })[];
};

function toAddressDto(address: CustomerAddress & { deliveryZone: DeliveryZone | null }): AddressDto {
  return {
    id: address.publicId,
    label: address.label,
    street: address.street,
    number: address.number,
    apartment: address.apartment,
    neighborhood: address.neighborhood,
    city: address.city,
    reference: address.reference,
    deliveryZone: address.deliveryZone
      ? {
          id: address.deliveryZone.publicId,
          name: address.deliveryZone.name,
          feeCents: address.deliveryZone.feeCents,
        }
      : null,
    isDefault: address.isDefault,
  };
}

export function toCustomerDto(customer: CustomerWithRelations): CustomerDto {
  return {
    id: customer.publicId,
    name: customer.name,
    phone: customer.phoneE164,
    notes: customer.notes,
    ordersCount: customer.ordersCount,
    totalSpentCents: customer.totalSpentCents,
    lastOrderAt: customer.lastOrderAt?.toISOString() ?? null,
    isActive: customer.isActive,
    addresses: customer.addresses.map(toAddressDto),
  };
}

export const customerInclude = {
  addresses: { include: { deliveryZone: true } },
} as const;

function normalizeOrThrow(raw: string, country: CountryCode): string {
  try {
    return normalizePhone(raw, country);
  } catch (err) {
    if (err instanceof InvalidPhoneError) {
      throw new ValidationError('El teléfono no tiene un formato válido');
    }
    throw err;
  }
}

async function resolveZoneId(ctx: TenantContext, publicId?: string): Promise<number | null> {
  if (!publicId) return null;
  const zone = await ctx.db.deliveryZone.findFirst({ where: { publicId } });
  if (!zone) throw new ValidationError('La zona de envío indicada no existe');
  return zone.id;
}

export async function listCustomers(
  ctx: TenantContext,
  params: { limit: number; cursor?: string } & CustomerFilters,
): Promise<Page<CustomerDto>> {
  // Un teléfono se busca normalizado; si no se puede normalizar, se busca por
  // el texto crudo para no dejar al operador sin resultados.
  const normalized = params.phone ? tryNormalizePhone(params.phone, ctx.commerce.country) : null;

  const rows = await ctx.db.customer.findMany({
    where: {
      ...(normalized ? { phoneE164: normalized } : {}),
      ...(params.phone && !normalized ? { phoneE164: { contains: params.phone } } : {}),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search } },
              { phoneE164: { contains: params.search } },
            ],
          }
        : {}),
    },
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: decodeCursor(params.cursor) }, skip: 1 } : {}),
    orderBy: { id: 'asc' },
    include: customerInclude,
  });

  return buildPage(rows, params.limit, toCustomerDto);
}

async function findOrThrow(ctx: TenantContext, publicId: string): Promise<CustomerWithRelations> {
  const customer = await ctx.db.customer.findFirst({
    where: { publicId },
    include: customerInclude,
  });
  if (!customer) throw new NotFoundError('El cliente no existe');
  return customer;
}

export async function getCustomer(ctx: TenantContext, publicId: string): Promise<CustomerDto> {
  return toCustomerDto(await findOrThrow(ctx, publicId));
}

/** Búsqueda por teléfono exacto: es la que va a usar `buscar_cliente()` en la fase 2. */
export async function findByPhone(ctx: TenantContext, phone: string): Promise<CustomerDto | null> {
  const normalized = tryNormalizePhone(phone, ctx.commerce.country);
  if (!normalized) return null;

  const customer = await ctx.db.customer.findFirst({
    where: { phoneE164: normalized },
    include: customerInclude,
  });
  return customer ? toCustomerDto(customer) : null;
}

async function createAddresses(
  ctx: TenantContext,
  customerId: number,
  addresses: AddressInput[],
): Promise<void> {
  for (const [index, address] of addresses.entries()) {
    await ctx.db.customerAddress.create({
      data: {
        commerceId: ctx.commerceId,
        customerId,
        label: address.label ?? null,
        street: address.street,
        number: address.number ?? null,
        apartment: address.apartment ?? null,
        neighborhood: address.neighborhood ?? null,
        city: address.city ?? null,
        reference: address.reference ?? null,
        deliveryZoneId: await resolveZoneId(ctx, address.deliveryZoneId),
        isDefault: address.isDefault || index === 0,
      },
    });
  }
}

export async function createCustomer(
  ctx: TenantContext,
  input: CreateCustomerInput,
): Promise<CustomerDto> {
  const phoneE164 = normalizeOrThrow(input.phone, ctx.commerce.country);

  try {
    const customer = await ctx.db.customer.create({
      data: {
        commerceId: ctx.commerceId,
        name: input.name,
        phoneE164,
        phoneRaw: input.phone,
        notes: input.notes ?? null,
      },
    });

    await createAddresses(ctx, customer.id, input.addresses);
    return toCustomerDto(await findOrThrow(ctx, customer.publicId));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('CONFLICT', 'Ya existe un cliente con ese teléfono');
    }
    throw err;
  }
}

export async function updateCustomer(
  ctx: TenantContext,
  publicId: string,
  input: UpdateCustomerInput,
): Promise<CustomerDto> {
  const customer = await findOrThrow(ctx, publicId);
  const phoneE164 = input.phone ? normalizeOrThrow(input.phone, ctx.commerce.country) : undefined;

  try {
    await ctx.db.customer.update({
      where: { id: customer.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(phoneE164 === undefined ? {} : { phoneE164, phoneRaw: input.phone }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('CONFLICT', 'Ya existe un cliente con ese teléfono');
    }
    throw err;
  }

  if (input.addresses) {
    // Reemplazo completo: las direcciones no tienen historial propio, y el
    // pedido guarda una copia de la que usó.
    await ctx.db.customerAddress.deleteMany({ where: { customerId: customer.id } });
    await createAddresses(ctx, customer.id, input.addresses);
  }

  return toCustomerDto(await findOrThrow(ctx, publicId));
}

/**
 * Recalcula los agregados del cliente.
 *
 * Se llama al confirmar o cancelar un pedido. Está denormalizado a propósito:
 * abrir una ficha no debería recorrer todo el historial.
 */
export async function refreshCustomerStats(ctx: TenantContext, customerId: number): Promise<void> {
  const result = await ctx.db.order.aggregate({
    where: { customerId, status: { not: 'CANCELADO' } },
    _count: { _all: true },
    _sum: { totalCents: true },
    _max: { placedAt: true },
  });

  await ctx.db.customer.update({
    where: { id: customerId },
    data: {
      ordersCount: result._count._all,
      totalSpentCents: result._sum.totalCents ?? 0,
      lastOrderAt: result._max.placedAt,
    },
  });
}
