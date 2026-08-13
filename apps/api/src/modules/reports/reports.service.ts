import { ACTIVE_ORDER_STATUSES, type DashboardDto, type OrderType } from '@autoelite/shared';
import { prisma } from '../../db/prisma.js';
import type { TenantContext } from '../../http/context.js';
import { businessDateOf, formatDateColumn, toDateColumn } from '../../shared/business-date.js';
import { NotFoundError } from '../../shared/errors.js';

/**
 * Métricas del dashboard.
 *
 * Todo se agrega por día operativo, no por medianoche: si los números no
 * coinciden con el cierre de caja, el dueño deja de mirar el dashboard.
 *
 * Los pedidos cancelados no cuentan en ninguna métrica de venta.
 */

const NOT_CANCELLED = { status: { not: 'CANCELADO' as const } };

export async function getDashboard(
  ctx: TenantContext,
  range: { from?: string; to?: string },
): Promise<DashboardDto> {
  const commerce = await prisma.commerce.findUnique({ where: { id: ctx.commerceId } });
  if (!commerce) throw new NotFoundError('El comercio no existe');

  const today = businessDateOf(new Date(), commerce.timezone, commerce.businessDayCutoff);
  const from = range.from ?? today;
  const to = range.to ?? today;

  const dateFilter = {
    businessDate: { gte: toDateColumn(from), lte: toDateColumn(to) },
  };
  const salesWhere = { ...dateFilter, ...NOT_CANCELLED };

  const [totals, activeOrdersCount, byTypeRaw, byPaymentRaw, topProductsRaw, byDayRaw] =
    await Promise.all([
      ctx.db.order.aggregate({
        where: salesWhere,
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      ctx.db.order.count({ where: { status: { in: ACTIVE_ORDER_STATUSES } } }),
      ctx.db.order.groupBy({
        by: ['type'],
        where: salesWhere,
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      ctx.db.order.groupBy({
        by: ['paymentMethodName'],
        where: salesWhere,
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      ctx.db.orderItem.groupBy({
        by: ['productName'],
        where: { order: salesWhere },
        _sum: { quantity: true, lineTotalCents: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 8,
      }),
      ctx.db.order.groupBy({
        by: ['businessDate'],
        where: salesWhere,
        _count: { _all: true },
        _sum: { totalCents: true },
        orderBy: { businessDate: 'asc' },
      }),
    ]);

  const salesCents = totals._sum.totalCents ?? 0;
  const ordersCount = totals._count._all;

  return {
    range: { from, to },
    salesCents,
    ordersCount,
    // Se redondea al centavo: un promedio con decimales infinitos no ayuda a nadie.
    averageTicketCents: ordersCount === 0 ? 0 : Math.round(salesCents / ordersCount),
    activeOrdersCount,
    byType: byTypeRaw.map((row) => ({
      type: row.type as OrderType,
      ordersCount: row._count._all,
      salesCents: row._sum.totalCents ?? 0,
    })),
    byPaymentMethod: byPaymentRaw.map((row) => ({
      name: row.paymentMethodName ?? 'Sin especificar',
      ordersCount: row._count._all,
      salesCents: row._sum.totalCents ?? 0,
    })),
    topProducts: topProductsRaw.map((row) => ({
      name: row.productName,
      quantity: row._sum.quantity ?? 0,
      salesCents: row._sum.lineTotalCents ?? 0,
    })),
    salesByDay: byDayRaw.map((row) => ({
      date: formatDateColumn(row.businessDate),
      salesCents: row._sum.totalCents ?? 0,
      ordersCount: row._count._all,
    })),
  };
}
