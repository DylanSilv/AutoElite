import {
  allowedTransitions,
  type OrderDto,
  type OrderItemDto,
  type OrderSummaryDto,
} from '@autoelite/shared';
import type {
  Order,
  OrderItem,
  OrderItemModifier,
  OrderStatusHistory,
} from '@prisma/client';
import { formatDateColumn } from '../../shared/business-date.js';

type OrderWithItems = Order & {
  items: (OrderItem & { modifiers: OrderItemModifier[] })[];
};

type OrderFull = OrderWithItems & { statusHistory: OrderStatusHistory[] };

export const orderListInclude = {
  items: { include: { modifiers: true } },
} as const;

export const orderDetailInclude = {
  items: { include: { modifiers: true } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
} as const;

function toItemDto(item: OrderItem & { modifiers: OrderItemModifier[] }): OrderItemDto {
  return {
    id: item.publicId,
    productName: item.productName,
    variantName: item.variantName,
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    notes: item.notes,
    lineTotalCents: item.lineTotalCents,
    modifiers: item.modifiers.map((m) => ({ name: m.name, priceDeltaCents: m.priceDeltaCents })),
  };
}

export function toOrderSummaryDto(order: OrderWithItems): OrderSummaryDto {
  return {
    id: order.publicId,
    number: order.number,
    type: order.type,
    status: order.status,
    source: order.source,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    itemsCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    isPaid: order.isPaid,
    placedAt: order.placedAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function toOrderDto(order: OrderFull): OrderDto {
  return {
    ...toOrderSummaryDto(order),
    businessDate: formatDateColumn(order.businessDate),
    customerId: null,
    address: order.deliveryStreet
      ? {
          street: order.deliveryStreet,
          number: order.deliveryNumber,
          apartment: order.deliveryApartment,
          neighborhood: order.deliveryNeighborhood,
          reference: order.deliveryReference,
          zoneName: order.deliveryZoneName,
        }
      : null,
    paymentMethodName: order.paymentMethodName,
    paidWithCents: order.paidWithCents,
    notes: order.notes,
    scheduledFor: order.scheduledFor?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    items: order.items.map(toItemDto),
    statusHistory: order.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      note: entry.note,
      changedBy: null,
      createdAt: entry.createdAt.toISOString(),
    })),
    // La UI no tiene que replicar la máquina de estados: el backend le dice qué
    // botones mostrar.
    allowedTransitions: allowedTransitions(order.status, order.type),
  };
}
