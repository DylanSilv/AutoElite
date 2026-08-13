import {
  ACTIVE_ORDER_STATUSES,
  type CancelOrderInput,
  type CreateOrderInput,
  type OrderBoardDto,
  type OrderDto,
  type OrderFilters,
  type OrderQuoteDto,
  type OrderSummaryDto,
  type Page,
  type QuoteOrderInput,
  type ChangeStatusInput,
} from '@autoelite/shared';
import { Prisma, type OrderStatus } from '@prisma/client';
import type { TenantContext } from '../../http/context.js';
import { prisma } from '../../db/prisma.js';
import {
  businessDateOf,
  formatDateColumn,
  toDateColumn,
} from '../../shared/business-date.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { buildPage, decodeCursor } from '../../shared/pagination.js';
import { tryNormalizePhone } from '../../shared/phone.js';
import { refreshCustomerStats } from '../customers/customers.service.js';
import { enqueueOrderMessage, notifyStatusChange } from '../messaging/messaging.service.js';
import { orderDetailInclude, orderListInclude, toOrderDto, toOrderSummaryDto } from './orders.mapper.js';
import { computeLineTotal, computeTotals, type PricedLine } from './orders.pricing.js';
import {
  assertExpectedStatus,
  assertTransitionAllowed,
} from './orders.state-machine.js';

/**
 * Convierte los items del request en líneas con precios congelados.
 *
 * Los precios y la disponibilidad salen siempre de la base, nunca de lo que
 * mande el cliente HTTP: es lo que evita que el agente de IA —o un panel
 * desactualizado— cobre de menos.
 */
async function resolveLines(ctx: TenantContext, input: QuoteOrderInput): Promise<PricedLine[]> {
  const variantIds = input.items.map((item) => item.variantId);
  const variants = await ctx.db.productVariant.findMany({
    where: { publicId: { in: variantIds }, deletedAt: null },
    include: { product: true },
  });

  const optionIds = [...new Set(input.items.flatMap((item) => item.modifierOptionIds))];
  const options = optionIds.length
    ? await ctx.db.modifierOption.findMany({ where: { publicId: { in: optionIds } } })
    : [];

  return input.items.map((item) => {
    const variant = variants.find((v) => v.publicId === item.variantId);
    if (!variant) throw new ValidationError(`El producto seleccionado ya no está disponible`);
    if (!variant.isAvailable || !variant.product.isAvailable || variant.product.deletedAt) {
      throw new ValidationError(`"${variant.product.name} ${variant.name}" no está disponible`);
    }

    const modifiers = item.modifierOptionIds.map((optionId) => {
      const option = options.find((o) => o.publicId === optionId);
      if (!option) throw new ValidationError('Uno de los adicionales ya no está disponible');
      if (!option.isAvailable) throw new ValidationError(`"${option.name}" no está disponible`);
      return {
        optionId: option.id,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
      };
    });

    return {
      productId: variant.productId,
      variantId: variant.id,
      productName: variant.product.name,
      variantName: variant.name,
      unitPriceCents: variant.priceCents,
      quantity: item.quantity,
      notes: item.notes ?? null,
      modifiers,
      lineTotalCents: computeLineTotal(variant.priceCents, modifiers, item.quantity),
    };
  });
}

interface DeliveryInfo {
  feeCents: number;
  street: string | null;
  number: string | null;
  apartment: string | null;
  neighborhood: string | null;
  reference: string | null;
  zoneName: string | null;
}

const NO_DELIVERY: DeliveryInfo = {
  feeCents: 0,
  street: null,
  number: null,
  apartment: null,
  neighborhood: null,
  reference: null,
  zoneName: null,
};

async function resolveDelivery(ctx: TenantContext, input: QuoteOrderInput): Promise<DeliveryInfo> {
  if (input.type !== 'DELIVERY') return NO_DELIVERY;
  if (!input.address) {
    // En una cotización todavía puede no haber dirección; el costo se suma
    // cuando el cliente decide a dónde se lo mandan.
    return { ...NO_DELIVERY, feeCents: input.deliveryFeeCents ?? 0 };
  }

  const zone = input.address.deliveryZoneId
    ? await ctx.db.deliveryZone.findFirst({ where: { publicId: input.address.deliveryZoneId } })
    : null;

  if (input.address.deliveryZoneId && !zone) {
    throw new ValidationError('La zona de envío indicada no existe');
  }

  return {
    // El operador puede sobrescribir la tarifa de la zona: hay casos que no
    // entran en ninguna grilla.
    feeCents: input.deliveryFeeCents ?? zone?.feeCents ?? 0,
    street: input.address.street,
    number: input.address.number ?? null,
    apartment: input.address.apartment ?? null,
    neighborhood: input.address.neighborhood ?? null,
    reference: input.address.reference ?? null,
    zoneName: zone?.name ?? null,
  };
}

export async function quoteOrder(
  ctx: TenantContext,
  input: QuoteOrderInput,
): Promise<OrderQuoteDto> {
  const lines = await resolveLines(ctx, input);
  const delivery = await resolveDelivery(ctx, input);
  const totals = computeTotals(lines, delivery.feeCents, input.discountCents);

  return {
    ...totals,
    items: lines.map((line) => ({
      productName: line.productName,
      variantName: line.variantName,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      notes: line.notes,
      lineTotalCents: line.lineTotalCents,
      modifiers: line.modifiers.map((m) => ({
        name: m.name,
        priceDeltaCents: m.priceDeltaCents,
      })),
    })),
  };
}

/**
 * Correlativo por comercio y día operativo, bajo bloqueo transaccional.
 *
 * No se usa el autoincremento global porque filtraría el volumen del negocio
 * entre comercios y daría números impracticables para gritar en una cocina.
 */
async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  commerceId: number,
  businessDate: Date,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO OrderCounter (commerceId, businessDate, lastNumber)
    VALUES (${commerceId}, ${businessDate}, 1)
    ON DUPLICATE KEY UPDATE lastNumber = lastNumber + 1
  `;

  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    SELECT lastNumber FROM OrderCounter
    WHERE commerceId = ${commerceId} AND businessDate = ${businessDate}
  `;

  const value = rows[0]?.lastNumber;
  if (value === undefined) throw new Error('No se pudo generar el número de pedido');
  return Number(value);
}

/**
 * Resuelve el cliente del pedido.
 *
 * Si viene un teléfono sin cliente asociado, se busca o se crea: así la ficha y
 * el historial se arman solos, tanto desde el panel como desde el agente.
 */
async function resolveCustomer(
  ctx: TenantContext,
  input: CreateOrderInput,
): Promise<{ id: number | null; name: string; phone: string | null }> {
  if (input.customerId) {
    const customer = await ctx.db.customer.findFirst({ where: { publicId: input.customerId } });
    if (!customer) throw new ValidationError('El cliente indicado no existe');
    return { id: customer.id, name: customer.name, phone: customer.phoneE164 };
  }

  const phoneE164 = input.customerPhone
    ? tryNormalizePhone(input.customerPhone, ctx.commerce.country)
    : null;
  const name = input.customerName?.trim() || 'Cliente';

  if (!phoneE164) return { id: null, name, phone: null };

  const existing = await ctx.db.customer.findFirst({ where: { phoneE164 } });
  if (existing) return { id: existing.id, name: existing.name, phone: existing.phoneE164 };

  const created = await ctx.db.customer.create({
    data: {
      commerceId: ctx.commerceId,
      name,
      phoneE164,
      phoneRaw: input.customerPhone ?? null,
    },
  });
  return { id: created.id, name: created.name, phone: created.phoneE164 };
}

export async function createOrder(
  ctx: TenantContext,
  input: CreateOrderInput,
  idempotencyKey?: string,
): Promise<OrderDto> {
  // Reintento de n8n o del agente: se devuelve el pedido ya creado en lugar de
  // mandar dos veces la misma comanda a la cocina.
  if (idempotencyKey) {
    const existing = await ctx.db.order.findFirst({
      where: { idempotencyKey },
      include: orderDetailInclude,
    });
    if (existing) return toOrderDto(existing);
  }

  const lines = await resolveLines(ctx, input);
  const delivery = await resolveDelivery(ctx, input);
  const totals = computeTotals(lines, delivery.feeCents, input.discountCents);
  const customer = await resolveCustomer(ctx, input);

  const paymentMethod = input.paymentMethodId
    ? await ctx.db.paymentMethod.findFirst({ where: { publicId: input.paymentMethodId } })
    : null;
  if (input.paymentMethodId && !paymentMethod) {
    throw new ValidationError('El método de pago indicado no existe');
  }

  const placedAt = new Date();
  const businessDate = toDateColumn(
    businessDateOf(placedAt, ctx.commerce.timezone, ctx.commerce.businessDayCutoff),
  );

  const actorFields =
    ctx.actor.kind === 'user'
      ? { createdByUserId: ctx.actor.id }
      : { createdByApiClientId: ctx.actor.id };

  const orderId = await prisma.$transaction(async (tx) => {
    const number = await nextOrderNumber(tx, ctx.commerceId, businessDate);

    const order = await tx.order.create({
      data: {
        commerceId: ctx.commerceId,
        number,
        businessDate,
        type: input.type,
        status: 'PENDIENTE',
        source: input.source,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        deliveryStreet: delivery.street,
        deliveryNumber: delivery.number,
        deliveryApartment: delivery.apartment,
        deliveryNeighborhood: delivery.neighborhood,
        deliveryReference: delivery.reference,
        deliveryZoneName: delivery.zoneName,
        paymentMethodId: paymentMethod?.id ?? null,
        paymentMethodName: paymentMethod?.name ?? null,
        paidWithCents: input.paidWithCents ?? null,
        isPaid: input.isPaid,
        subtotalCents: totals.subtotalCents,
        deliveryFeeCents: totals.deliveryFeeCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        notes: input.notes ?? null,
        scheduledFor: input.scheduledFor ?? null,
        idempotencyKey: idempotencyKey ?? null,
        placedAt,
        ...actorFields,
        items: {
          create: lines.map((line) => ({
            commerceId: ctx.commerceId,
            productId: line.productId,
            variantId: line.variantId,
            productName: line.productName,
            variantName: line.variantName,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            notes: line.notes,
            lineTotalCents: line.lineTotalCents,
            modifiers: {
              create: line.modifiers.map((m) => ({
                commerceId: ctx.commerceId,
                optionId: m.optionId,
                name: m.name,
                priceDeltaCents: m.priceDeltaCents,
              })),
            },
          })),
        },
        statusHistory: {
          create: {
            commerceId: ctx.commerceId,
            fromStatus: null,
            toStatus: 'PENDIENTE',
            ...(ctx.actor.kind === 'user'
              ? { changedByUserId: ctx.actor.id }
              : { changedByApiClientId: ctx.actor.id }),
          },
        },
      },
    });

    return order.id;
  });

  if (customer.id) await refreshCustomerStats(ctx, customer.id);

  const created = await ctx.db.order.findFirst({
    where: { id: orderId },
    include: orderDetailInclude,
  });
  if (!created) throw new NotFoundError('El pedido no existe');

  // Sólo se acusa recibo de los pedidos que llegaron por un canal
  // conversacional. En uno tomado por teléfono o en el mostrador, el cliente ya
  // sabe que su pedido entró: el mensaje sobraría.
  if (created.source === 'WHATSAPP' || created.source === 'WEB') {
    await enqueueOrderMessage(ctx, { order: created, kind: 'ORDER_RECEIVED' });
  }

  return toOrderDto(created);
}

export async function listOrders(
  ctx: TenantContext,
  params: { limit: number; cursor?: string } & OrderFilters,
): Promise<Page<OrderSummaryDto>> {
  const rows = await ctx.db.order.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.customerId ? { customer: { publicId: params.customerId } } : {}),
      ...(params.from || params.to
        ? {
            businessDate: {
              ...(params.from ? { gte: toDateColumn(params.from) } : {}),
              ...(params.to ? { lte: toDateColumn(params.to) } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { customerName: { contains: params.search } },
              { customerPhone: { contains: params.search } },
            ],
          }
        : {}),
    },
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: decodeCursor(params.cursor) }, skip: 1 } : {}),
    // Descendente: el historial se mira de lo más nuevo a lo más viejo.
    orderBy: { id: 'desc' },
    include: orderListInclude,
  });

  return buildPage(rows, params.limit, toOrderSummaryDto);
}

/** Vista operativa del día: lo que está abierto en la pantalla toda la noche. */
export async function getBoard(ctx: TenantContext): Promise<OrderBoardDto> {
  const businessDate = businessDateOf(
    new Date(),
    ctx.commerce.timezone,
    ctx.commerce.businessDayCutoff,
  );

  const orders = await ctx.db.order.findMany({
    where: {
      OR: [
        { businessDate: toDateColumn(businessDate) },
        // Un pedido de ayer que todavía está en camino tiene que seguir a la
        // vista aunque haya cambiado el día operativo.
        { status: { in: ACTIVE_ORDER_STATUSES } },
      ],
    },
    orderBy: { placedAt: 'asc' },
    include: orderListInclude,
  });

  const summaries = orders.map(toOrderSummaryDto);

  // El tablero muestra sólo lo que está en curso: los entregados se cuentan
  // aparte y se consultan en el historial. Así las columnas entran en pantalla
  // sin scroll horizontal, que es como se usa durante el servicio.
  return {
    businessDate,
    deliveredCount: summaries.filter((order) => order.status === 'ENTREGADO').length,
    columns: ACTIVE_ORDER_STATUSES.map((status) => ({
      status,
      orders: summaries.filter((order) => order.status === status),
    })),
  };
}

async function findOrThrow(ctx: TenantContext, publicId: string) {
  const order = await ctx.db.order.findFirst({
    where: { publicId },
    include: orderDetailInclude,
  });
  if (!order) throw new NotFoundError('El pedido no existe');
  return order;
}

export async function getOrder(ctx: TenantContext, publicId: string): Promise<OrderDto> {
  return toOrderDto(await findOrThrow(ctx, publicId));
}

async function applyStatus(
  ctx: TenantContext,
  publicId: string,
  to: OrderStatus,
  options: { expectedFrom?: OrderStatus; note?: string; cancelReason?: string },
): Promise<OrderDto> {
  const order = await findOrThrow(ctx, publicId);

  if (options.expectedFrom) assertExpectedStatus(order.status, options.expectedFrom);
  assertTransitionAllowed(order.status, to, order.type);

  await ctx.db.order.update({
    where: { id: order.id },
    data: {
      status: to,
      ...(options.cancelReason ? { cancelReason: options.cancelReason } : {}),
      // Entregar un pedido implica que se cobró, salvo que ya estuviera marcado.
      ...(to === 'ENTREGADO' ? { isPaid: true } : {}),
      statusHistory: {
        create: {
          commerceId: ctx.commerceId,
          fromStatus: order.status,
          toStatus: to,
          note: options.note ?? options.cancelReason ?? null,
          ...(ctx.actor.kind === 'user'
            ? { changedByUserId: ctx.actor.id }
            : { changedByApiClientId: ctx.actor.id }),
        },
      },
    },
  });

  // Cancelar saca el pedido de los totales del cliente.
  if (order.customerId) await refreshCustomerStats(ctx, order.customerId);

  const updated = await findOrThrow(ctx, publicId);
  await notifyStatusChange(ctx, updated);

  // Se relee para que la respuesta incluya el aviso recién encolado: el panel
  // muestra los avisos en el detalle, y si faltara el último parecería que el
  // cliente no fue notificado.
  return toOrderDto(await findOrThrow(ctx, publicId));
}

export function changeStatus(
  ctx: TenantContext,
  publicId: string,
  input: ChangeStatusInput,
): Promise<OrderDto> {
  return applyStatus(ctx, publicId, input.to, {
    expectedFrom: input.from,
    note: input.note,
  });
}

export function cancelOrder(
  ctx: TenantContext,
  publicId: string,
  input: CancelOrderInput,
): Promise<OrderDto> {
  return applyStatus(ctx, publicId, 'CANCELADO', { cancelReason: input.reason });
}

export { formatDateColumn };
