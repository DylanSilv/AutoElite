import {
  isAwaitingPayment,
  type OrderType,
  type PaymentStatus,
  type RejectPaymentInput,
  type ReviewPaymentInput,
  type SubmitPaymentProofInput,
} from '@autoelite/shared';
import type { Order, PaymentMethod } from '@prisma/client';
import type { TenantContext } from '../../http/context.js';
import { BusinessRuleError, ForbiddenError, ValidationError } from '../../shared/errors.js';

/**
 * Cobro previo.
 *
 * La regla del negocio: un pedido que llega por WhatsApp y se paga por
 * transferencia o Mercado Pago no puede llegar a la cocina hasta que alguien
 * verifique el pago. Sin eso, un pedido de alguien que nunca aparece deja la
 * comida hecha y perdida.
 *
 * El estado de cobro es un eje separado del avance en la cocina a propósito: un
 * pedido que se paga contra entrega tiene que llegar a la cocina igual, y uno
 * prepago no puede llegar aunque el mostrador quiera apurarlo.
 */

/** Modalidades donde el método se puede usar. Sin restricción declarada, todas. */
function allowedTypes(method: PaymentMethod): OrderType[] | null {
  const raw = method.allowedOrderTypes;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.filter((value): value is OrderType => typeof value === 'string') as OrderType[];
}

export function assertMethodAllowedForType(method: PaymentMethod, type: OrderType): void {
  const allowed = allowedTypes(method);
  if (allowed && !allowed.includes(type)) {
    // El caso típico: efectivo sólo en el local. Cobrar efectivo en un envío
    // implica que el cadete maneje plata y vuelto.
    throw new BusinessRuleError(
      'VALIDATION_ERROR',
      `${method.name} no está disponible para esta modalidad`,
      { allowed },
    );
  }
}

/**
 * Estado de cobro inicial de un pedido.
 *
 * Sólo se exige pago previo cuando el método lo pide. Si el pedido se carga
 * desde el panel, el personal ya está mirando al cliente: no tiene sentido
 * frenarlo.
 */
export function initialPaymentStatus(
  method: PaymentMethod | null,
  source: string,
): PaymentStatus {
  if (!method?.requiresPrepayment) return 'NOT_REQUIRED';
  // Los canales conversacionales son los que no tienen a nadie enfrente.
  if (source === 'PANEL' || source === 'PHONE') return 'NOT_REQUIRED';
  return 'PENDING';
}

/**
 * Impide que un pedido impago entre a la cocina.
 *
 * Se aplica al salir de PENDIENTE, que es el momento en que el personal lo toma
 * como trabajo. Cancelar siempre está permitido: un pedido que nunca se pagó
 * tiene que poder descartarse.
 */
export function assertPaymentAllowsProgress(order: Order, nextStatus: string): void {
  if (nextStatus === 'CANCELADO') return;
  if (!isAwaitingPayment(order.paymentStatus as PaymentStatus)) return;

  throw new BusinessRuleError(
    'VALIDATION_ERROR',
    'El pedido todavía no está pago: verificá el comprobante antes de avanzarlo',
    { paymentStatus: order.paymentStatus },
  );
}

/** Registra el comprobante que mandó el cliente y lo deja para verificar. */
export async function submitPaymentProof(
  ctx: TenantContext,
  order: Order,
  input: SubmitPaymentProofInput,
): Promise<void> {
  if (order.paymentStatus === 'NOT_REQUIRED') {
    throw new ValidationError('Este pedido no requiere pago previo');
  }
  if (order.paymentStatus === 'CONFIRMED') {
    throw new ValidationError('El pago de este pedido ya está confirmado');
  }
  if (!input.mediaUrl && !input.whatsappMediaId) {
    throw new ValidationError('Falta la imagen del comprobante');
  }

  await ctx.db.paymentProof.create({
    data: {
      commerceId: ctx.commerceId,
      orderId: order.id,
      mediaUrl: input.mediaUrl ?? null,
      whatsappMediaId: input.whatsappMediaId ?? null,
      mimeType: input.mimeType ?? null,
      note: input.note ?? null,
    },
  });

  await ctx.db.order.update({
    where: { id: order.id },
    // Vuelve a "por verificar" incluso si venía rechazado: el cliente pudo
    // mandar el comprobante correcto en el segundo intento.
    data: { paymentStatus: 'PROOF_SUBMITTED' },
  });
}

/**
 * Confirma el pago.
 *
 * Sólo lo puede hacer una persona: un comprobante es una imagen y las imágenes
 * se falsifican. Quien confirma tiene que haber mirado la cuenta.
 */
export async function confirmPayment(
  ctx: TenantContext,
  order: Order,
  input: ReviewPaymentInput,
): Promise<void> {
  if (ctx.actor.kind !== 'user') {
    throw new ForbiddenError(
      'FORBIDDEN',
      'Confirmar un pago requiere una persona: un comprobante se falsifica y hay que mirarlo contra la cuenta',
    );
  }
  if (order.paymentStatus === 'NOT_REQUIRED') {
    throw new ValidationError('Este pedido no requiere pago previo');
  }

  await ctx.db.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: 'CONFIRMED',
      isPaid: true,
      paidAt: new Date(),
      paymentNote: input.note ?? null,
      paymentReviewedByUserId: ctx.actor.id,
    },
  });
}

export async function rejectPayment(
  ctx: TenantContext,
  order: Order,
  input: RejectPaymentInput,
): Promise<void> {
  if (ctx.actor.kind !== 'user') {
    throw new ForbiddenError('FORBIDDEN', 'Rechazar un pago requiere una persona');
  }
  if (order.paymentStatus === 'NOT_REQUIRED') {
    throw new ValidationError('Este pedido no requiere pago previo');
  }

  await ctx.db.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: 'REJECTED',
      isPaid: false,
      paidAt: null,
      paymentNote: input.note,
      paymentReviewedByUserId: ctx.actor.id,
    },
  });
}
