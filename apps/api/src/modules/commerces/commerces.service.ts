import type { CommerceDto, UpdateCommerceInput } from '@autoelite/shared';
import type { Commerce } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { TenantContext } from '../../http/context.js';
import { NotFoundError } from '../../shared/errors.js';

function toCommerceDto(commerce: Commerce): CommerceDto {
  return {
    id: commerce.publicId,
    name: commerce.name,
    slug: commerce.slug,
    phone: commerce.phone,
    address: commerce.address,
    timezone: commerce.timezone,
    currency: commerce.currency,
    businessDayCutoff: commerce.businessDayCutoff,
    openingHours: commerce.openingHours,
    isActive: commerce.isActive,
  };
}

/**
 * Commerce es la raíz del tenant, no una tabla acotada por `commerceId`: se
 * accede por id directo, tomado siempre del actor autenticado.
 */
export async function getOwnCommerce(ctx: TenantContext): Promise<CommerceDto> {
  const commerce = await prisma.commerce.findUnique({ where: { id: ctx.commerceId } });
  if (!commerce) throw new NotFoundError('El comercio no existe');
  return toCommerceDto(commerce);
}

export async function updateOwnCommerce(
  ctx: TenantContext,
  input: UpdateCommerceInput,
): Promise<CommerceDto> {
  const commerce = await prisma.commerce.update({
    where: { id: ctx.commerceId },
    data: input,
  });
  return toCommerceDto(commerce);
}
