import type {
  CreatePromotionInput,
  PromotionDto,
  UpdatePromotionInput,
} from '@autoelite/shared';
import type { Promotion } from '@prisma/client';
import type { TenantContext } from '../../http/context.js';
import { NotFoundError } from '../../shared/errors.js';

/**
 * Promociones del comercio.
 *
 * Deliberadamente no calculan descuentos: son el texto que el asistente le
 * cuenta al cliente y que el personal puede editar sin ayuda. El importe
 * descontado, cuando lo haya, sigue viajando en `discountCents` del pedido.
 */

function weekdaysOf(promotion: Promotion): number[] {
  return Array.isArray(promotion.weekdays) ? (promotion.weekdays as number[]) : [];
}

/**
 * Si la promoción aplica en este momento.
 *
 * El día de la semana se evalúa en la zona horaria del comercio: un 2x1 de los
 * martes tiene que dejar de valer a la medianoche de Montevideo, no a la de UTC.
 */
export function isActiveOn(promotion: Promotion, at: Date, timeZone: string): boolean {
  if (!promotion.isActive) return false;
  if (promotion.startsAt && at < promotion.startsAt) return false;
  if (promotion.endsAt && at > promotion.endsAt) return false;

  const days = weekdaysOf(promotion);
  if (days.length === 0) return true;

  const weekday = new Date(at.toLocaleString('en-US', { timeZone })).getDay();
  return days.includes(weekday);
}

function toDto(promotion: Promotion, now: Date, timeZone: string): PromotionDto {
  return {
    id: promotion.publicId,
    title: promotion.title,
    description: promotion.description,
    startsAt: promotion.startsAt?.toISOString() ?? null,
    endsAt: promotion.endsAt?.toISOString() ?? null,
    weekdays: weekdaysOf(promotion),
    isActive: promotion.isActive,
    sortOrder: promotion.sortOrder,
    activeToday: isActiveOn(promotion, now, timeZone),
  };
}

/** Las que el asistente puede contar ahora mismo. */
export async function listActivePromotions(ctx: TenantContext): Promise<Promotion[]> {
  const now = new Date();
  const promotions = await ctx.db.promotion.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return promotions.filter((promotion) => isActiveOn(promotion, now, ctx.commerce.timezone));
}

export async function listPromotions(
  ctx: TenantContext,
  includeInactive = false,
): Promise<PromotionDto[]> {
  const now = new Date();
  const promotions = await ctx.db.promotion.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return promotions.map((promotion) => toDto(promotion, now, ctx.commerce.timezone));
}

export async function createPromotion(
  ctx: TenantContext,
  input: CreatePromotionInput,
): Promise<PromotionDto> {
  const promotion = await ctx.db.promotion.create({
    data: {
      commerceId: ctx.commerceId,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      weekdays: input.weekdays ?? [],
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
  return toDto(promotion, new Date(), ctx.commerce.timezone);
}

export async function updatePromotion(
  ctx: TenantContext,
  publicId: string,
  input: UpdatePromotionInput,
): Promise<PromotionDto> {
  const existing = await ctx.db.promotion.findFirst({ where: { publicId } });
  if (!existing) throw new NotFoundError('La promoción no existe');

  const updated = await ctx.db.promotion.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      ...(input.weekdays !== undefined ? { weekdays: input.weekdays } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  return toDto(updated, new Date(), ctx.commerce.timezone);
}

export async function deletePromotion(ctx: TenantContext, publicId: string): Promise<void> {
  const existing = await ctx.db.promotion.findFirst({ where: { publicId } });
  if (!existing) throw new NotFoundError('La promoción no existe');
  await ctx.db.promotion.delete({ where: { id: existing.id } });
}
