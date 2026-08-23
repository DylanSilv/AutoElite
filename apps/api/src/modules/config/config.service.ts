import type {
  CreateDeliveryZoneInput,
  CreatePaymentMethodInput,
  DeliveryZoneDto,
  PaymentMethodDto,
  UpdateDeliveryZoneInput,
  UpdatePaymentMethodInput,
} from '@autoelite/shared';
import { Prisma, type DeliveryZone, type PaymentMethod } from '@prisma/client';
import type { TenantContext } from '../../http/context.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';

function toZoneDto(zone: DeliveryZone): DeliveryZoneDto {
  return {
    id: zone.publicId,
    name: zone.name,
    feeCents: zone.feeCents,
    estimatedMin: zone.estimatedMin,
    isActive: zone.isActive,
    sortOrder: zone.sortOrder,
  };
}

function toPaymentMethodDto(method: PaymentMethod): PaymentMethodDto {
  return {
    id: method.publicId,
    name: method.name,
    code: method.code,
    requiresChangeFor: method.requiresChangeFor,
    requiresPrepayment: method.requiresPrepayment,
    allowedOrderTypes: Array.isArray(method.allowedOrderTypes)
      ? (method.allowedOrderTypes as string[])
      : null,
    instructions: method.instructions,
    qrImageUrl: method.qrImageUrl,
    isActive: method.isActive,
    sortOrder: method.sortOrder,
  };
}

function asConflict(err: unknown, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictError('CONFLICT', message);
  }
  throw err;
}

// ---------- Zonas de envío ----------

export async function listDeliveryZones(
  ctx: TenantContext,
  includeInactive = false,
): Promise<DeliveryZoneDto[]> {
  const zones = await ctx.db.deliveryZone.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return zones.map(toZoneDto);
}

export async function createDeliveryZone(
  ctx: TenantContext,
  input: CreateDeliveryZoneInput,
): Promise<DeliveryZoneDto> {
  try {
    return toZoneDto(
      await ctx.db.deliveryZone.create({ data: { ...input, commerceId: ctx.commerceId } }),
    );
  } catch (err) {
    asConflict(err, 'Ya existe una zona con ese nombre');
  }
}

export async function updateDeliveryZone(
  ctx: TenantContext,
  publicId: string,
  input: UpdateDeliveryZoneInput,
): Promise<DeliveryZoneDto> {
  const zone = await ctx.db.deliveryZone.findFirst({ where: { publicId } });
  if (!zone) throw new NotFoundError('La zona no existe');

  try {
    return toZoneDto(await ctx.db.deliveryZone.update({ where: { id: zone.id }, data: input }));
  } catch (err) {
    asConflict(err, 'Ya existe una zona con ese nombre');
  }
}

// ---------- Métodos de pago ----------

export async function listPaymentMethods(
  ctx: TenantContext,
  includeInactive = false,
): Promise<PaymentMethodDto[]> {
  const methods = await ctx.db.paymentMethod.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return methods.map(toPaymentMethodDto);
}

export async function createPaymentMethod(
  ctx: TenantContext,
  input: CreatePaymentMethodInput,
): Promise<PaymentMethodDto> {
  try {
    return toPaymentMethodDto(
      await ctx.db.paymentMethod.create({ data: { ...input, commerceId: ctx.commerceId } }),
    );
  } catch (err) {
    asConflict(err, 'Ya existe un método de pago con ese código');
  }
}

export async function updatePaymentMethod(
  ctx: TenantContext,
  publicId: string,
  input: UpdatePaymentMethodInput,
): Promise<PaymentMethodDto> {
  const method = await ctx.db.paymentMethod.findFirst({ where: { publicId } });
  if (!method) throw new NotFoundError('El método de pago no existe');

  try {
    return toPaymentMethodDto(
      await ctx.db.paymentMethod.update({ where: { id: method.id }, data: input }),
    );
  } catch (err) {
    asConflict(err, 'Ya existe un método de pago con ese código');
  }
}
