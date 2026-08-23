import { z } from 'zod';
import { phoneSchema } from './customers.js';

export const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = [
  'PENDIENTE',
  'CONFIRMADO',
  'EN_PREPARACION',
  'LISTO',
  'EN_CAMINO',
  'ENTREGADO',
  'CANCELADO',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ['PANEL', 'WHATSAPP', 'PHONE', 'WEB'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const PAYMENT_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'PROOF_SUBMITTED',
  'CONFIRMED',
  'REJECTED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  NOT_REQUIRED: 'Paga al recibir',
  PENDING: 'Esperando pago',
  PROOF_SUBMITTED: 'Comprobante a verificar',
  CONFIRMED: 'Pago confirmado',
  REJECTED: 'Pago rechazado',
};

/**
 * Estados en los que el pedido todavía no puede llegar a la cocina.
 *
 * Es el corazón del cobro previo: mientras el pago no esté verificado, el
 * pedido existe pero no se prepara.
 */
export const BLOCKING_PAYMENT_STATUSES: PaymentStatus[] = [
  'PENDING',
  'PROOF_SUBMITTED',
  'REJECTED',
];

export function isAwaitingPayment(status: PaymentStatus): boolean {
  return BLOCKING_PAYMENT_STATUSES.includes(status);
}

/** Estados que siguen "vivos" para la cocina y el mostrador. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'PENDIENTE',
  'CONFIRMADO',
  'EN_PREPARACION',
  'LISTO',
  'EN_CAMINO',
];

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  DINE_IN: 'En el local',
  TAKEAWAY: 'Retiro',
  DELIVERY: 'Envío',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADO: 'Confirmado',
  EN_PREPARACION: 'En preparación',
  LISTO: 'Listo',
  EN_CAMINO: 'En camino',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
};

/**
 * Transiciones válidas. `EN_CAMINO` sólo aplica a envíos, y por eso las
 * transiciones dependen del tipo de pedido y no sólo del estado actual.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDIENTE: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION: ['LISTO', 'CANCELADO'],
  LISTO: ['EN_CAMINO', 'ENTREGADO', 'CANCELADO'],
  EN_CAMINO: ['ENTREGADO', 'CANCELADO'],
  ENTREGADO: [],
  CANCELADO: [],
};

export function allowedTransitions(status: OrderStatus, type: OrderType): OrderStatus[] {
  return ORDER_TRANSITIONS[status].filter((next) =>
    next === 'EN_CAMINO' ? type === 'DELIVERY' : true,
  );
}

// ---------- Entrada ----------

export const orderItemInputSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(100),
  notes: z.string().max(300).trim().optional(),
  modifierOptionIds: z.array(z.string()).max(20).default([]),
});
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export const orderAddressInputSchema = z.object({
  street: z.string().min(1).max(160).trim(),
  number: z.string().max(20).trim().optional(),
  apartment: z.string().max(40).trim().optional(),
  neighborhood: z.string().max(80).trim().optional(),
  reference: z.string().max(500).trim().optional(),
  deliveryZoneId: z.string().optional(),
});
export type OrderAddressInput = z.infer<typeof orderAddressInputSchema>;

const orderBase = z.object({
  type: z.enum(ORDER_TYPES),
  items: z.array(orderItemInputSchema).min(1, 'El pedido necesita al menos un producto'),
  customerId: z.string().optional(),
  customerName: z.string().min(1).max(120).trim().optional(),
  customerPhone: phoneSchema.optional(),
  address: orderAddressInputSchema.optional(),
  /** Sobrescribe la tarifa de la zona cuando el operador cobra otra cosa. */
  deliveryFeeCents: z.number().int().min(0).max(100_000_000).optional(),
  discountCents: z.number().int().min(0).max(100_000_000).default(0),
  paymentMethodId: z.string().optional(),
  paidWithCents: z.number().int().min(0).max(100_000_000).optional(),
  isPaid: z.boolean().default(false),
  notes: z.string().max(1000).trim().optional(),
  scheduledFor: z.coerce.date().optional(),
  source: z.enum(ORDER_SOURCES).default('PANEL'),
});

/** Un envío sin dirección no se puede repartir. */
const requiresAddress = (v: z.infer<typeof orderBase>) => v.type !== 'DELIVERY' || Boolean(v.address);

export const quoteOrderSchema = orderBase;
export type QuoteOrderInput = z.infer<typeof quoteOrderSchema>;

export const createOrderSchema = orderBase.refine(requiresAddress, {
  message: 'Un pedido con envío necesita dirección',
  path: ['address'],
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const changeStatusSchema = z.object({
  /**
   * Estado del que se parte. Si no coincide con el actual la API responde 409:
   * dos personas tocando el mismo pedido no deben pisarse en silencio.
   */
  from: z.enum(ORDER_STATUSES),
  to: z.enum(ORDER_STATUSES),
  note: z.string().max(300).trim().optional(),
});
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

/** Comprobante que manda el cliente. Lo usa el agente al recibir la imagen. */
export const submitPaymentProofSchema = z.object({
  mediaUrl: z.string().url().max(500).optional(),
  whatsappMediaId: z.string().max(200).optional(),
  mimeType: z.string().max(100).optional(),
  note: z.string().max(500).trim().optional(),
});
export type SubmitPaymentProofInput = z.infer<typeof submitPaymentProofSchema>;

export const reviewPaymentSchema = z.object({
  note: z.string().max(300).trim().optional(),
});
export type ReviewPaymentInput = z.infer<typeof reviewPaymentSchema>;

export const rejectPaymentSchema = z.object({
  note: z.string().min(1, 'Indicá por qué no se pudo verificar el pago').max(300).trim(),
});
export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().min(1, 'Cancelar requiere un motivo').max(300).trim(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const orderFiltersSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  type: z.enum(ORDER_TYPES).optional(),
  source: z.enum(ORDER_SOURCES).optional(),
  customerId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().max(120).trim().optional(),
});
export type OrderFilters = z.infer<typeof orderFiltersSchema>;

// ---------- Salida ----------

export interface OrderItemModifierDto {
  name: string;
  priceDeltaCents: number;
}

export interface OrderItemDto {
  id: string;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  notes: string | null;
  lineTotalCents: number;
  modifiers: OrderItemModifierDto[];
}

export interface OrderTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
}

export interface OrderQuoteDto extends OrderTotals {
  items: Omit<OrderItemDto, 'id'>[];
}

export const MESSAGE_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  PENDING: 'Enviando',
  SENT: 'Enviado',
  FAILED: 'Falló',
  SKIPPED: 'No enviado',
};

/** Aviso automático al cliente, para que el personal sepa qué se le dijo. */
export interface OrderNotificationDto {
  kind: string;
  status: MessageStatus;
  body: string;
  skipReason: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface OrderStatusHistoryDto {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  changedBy: string | null;
  createdAt: string;
}

export interface PaymentProofDto {
  id: string;
  mediaUrl: string | null;
  mimeType: string | null;
  note: string | null;
  submittedAt: string;
}

export interface OrderSummaryDto extends OrderTotals {
  id: string;
  number: number;
  type: OrderType;
  status: OrderStatus;
  source: OrderSource;
  customerName: string;
  customerPhone: string | null;
  itemsCount: number;
  placedAt: string;
  updatedAt: string;
  isPaid: boolean;
  paymentStatus: PaymentStatus;
}

export interface OrderDto extends OrderSummaryDto {
  businessDate: string;
  customerId: string | null;
  address: {
    street: string;
    number: string | null;
    apartment: string | null;
    neighborhood: string | null;
    reference: string | null;
    zoneName: string | null;
  } | null;
  paymentMethodName: string | null;
  paidWithCents: number | null;
  notes: string | null;
  scheduledFor: string | null;
  cancelReason: string | null;
  paymentNote: string | null;
  paidAt: string | null;
  paymentProofs: PaymentProofDto[];
  items: OrderItemDto[];
  statusHistory: OrderStatusHistoryDto[];
  notifications: OrderNotificationDto[];
  allowedTransitions: OrderStatus[];
}

/** Vista operativa del día: los pedidos vivos, agrupados por estado. */
export interface OrderBoardDto {
  businessDate: string;
  /** Entregados del día: se cuentan, pero no ocupan una columna del tablero. */
  deliveredCount: number;
  /** Pedidos que esperan pago: no entraron a la cocina todavía. */
  awaitingPayment: OrderSummaryDto[];
  columns: { status: OrderStatus; orders: OrderSummaryDto[] }[];
}

// ---------- Dashboard ----------

export interface DashboardDto {
  range: { from: string; to: string };
  salesCents: number;
  ordersCount: number;
  averageTicketCents: number;
  activeOrdersCount: number;
  byType: { type: OrderType; ordersCount: number; salesCents: number }[];
  byPaymentMethod: { name: string; ordersCount: number; salesCents: number }[];
  topProducts: { name: string; quantity: number; salesCents: number }[];
  salesByDay: { date: string; salesCents: number; ordersCount: number }[];
}
