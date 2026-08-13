import { type Order, type PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { TenantContext } from '../../http/context.js';
import { logger } from '../../shared/logger.js';
import { getMessagingProvider, PermanentSendError } from './messaging.provider.js';
import {
  buildMessageBody,
  kindForTransition,
  type TemplatedMessageKind,
} from './messaging.templates.js';

/**
 * Cola de avisos automáticos al cliente.
 *
 * Encolar y enviar están separados a propósito: marcar un pedido como listo no
 * puede quedar esperando a la API de WhatsApp, y si el proveedor está caído el
 * aviso tiene que poder reintentarse en vez de perderse.
 */

/**
 * WhatsApp sólo permite escribirle libremente a alguien dentro de las 24 horas
 * posteriores a su último mensaje. Fuera de esa ventana hace falta una plantilla
 * aprobada por Meta, que todavía no tenemos: en ese caso el aviso se marca como
 * omitido con el motivo, en lugar de fallar contra el proveedor.
 */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Reintentos antes de dar el mensaje por perdido. */
const MAX_ATTEMPTS = 4;

interface EnqueueInput {
  order: Order;
  /**
   * Los avisos automáticos tienen plantilla. La respuesta del asistente
   * (`AGENT_REPLY`) no pasa por acá: la redacta él y la encola directo.
   */
  kind: TemplatedMessageKind;
  /** Necesario para el aviso de cobro: lleva alias, cuenta y QR. */
  paymentMethod?: PaymentMethod | null;
}

/**
 * Deja el aviso en la cola. Nunca lanza: un problema al notificar no puede
 * tumbar el cambio de estado del pedido, que es lo importante.
 */
export async function enqueueOrderMessage(
  ctx: TenantContext,
  { order, kind, paymentMethod }: EnqueueInput,
): Promise<void> {
  try {
    if (!order.customerPhone) return;

    const customer = order.customerId
      ? await ctx.db.customer.findFirst({ where: { id: order.customerId } })
      : null;

    const body = buildMessageBody(kind, {
      order,
      commerce: {
        name: ctx.commerce.name,
        currency: ctx.commerce.currency,
        address: null,
      },
      paymentMethod: paymentMethod
        ? {
            name: paymentMethod.name,
            instructions: paymentMethod.instructions,
            qrImageUrl: paymentMethod.qrImageUrl,
          }
        : null,
    });

    const skipReason = resolveSkipReason(customer);

    await ctx.db.outboundMessage.create({
      data: {
        commerceId: ctx.commerceId,
        orderId: order.id,
        customerId: order.customerId,
        toPhoneE164: order.customerPhone,
        kind,
        body,
        status: skipReason ? 'SKIPPED' : 'PENDING',
        skipReason,
      },
    });
  } catch (err) {
    logger.error({ err, orderId: order.id, kind }, 'No se pudo encolar el aviso al cliente');
  }
}

function resolveSkipReason(
  customer: { acceptsNotifications: boolean; lastInboundAt: Date | null } | null,
): string | null {
  if (customer && !customer.acceptsNotifications) {
    return 'El cliente pidió no recibir avisos automáticos';
  }

  const lastInbound = customer?.lastInboundAt;
  if (!lastInbound) {
    return 'El cliente nunca escribió por WhatsApp: se necesita una plantilla aprobada para iniciar la conversación';
  }
  if (Date.now() - lastInbound.getTime() > SERVICE_WINDOW_MS) {
    return 'Pasaron más de 24 horas desde el último mensaje del cliente: se necesita una plantilla aprobada';
  }

  return null;
}

/** Encola el aviso que corresponda a una transición, si corresponde alguno. */
export async function notifyStatusChange(ctx: TenantContext, order: Order): Promise<void> {
  const kind = kindForTransition(order.status, order.type);
  if (!kind) return;
  await enqueueOrderMessage(ctx, { order, kind });
}

export interface DispatchResult {
  sent: number;
  failed: number;
}

/**
 * Vacía la cola de pendientes.
 *
 * Corre sin acotar a un comercio porque es un proceso de fondo, no una
 * operación de usuario: cada mensaje ya lleva su `commerceId` desde que se
 * encoló.
 */
export async function dispatchPending(limit = 20): Promise<DispatchResult> {
  const pending = await prisma.outboundMessage.findMany({
    where: { status: 'PENDING', attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  if (pending.length === 0) return { sent: 0, failed: 0 };

  const provider = getMessagingProvider();
  let sent = 0;
  let failed = 0;

  for (const message of pending) {
    try {
      const { providerMessageId } = await provider.sendText(message.toPhoneE164, message.body);
      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: {
          status: 'SENT',
          providerMessageId,
          sentAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      sent += 1;
    } catch (err) {
      const permanent = err instanceof PermanentSendError;
      const attempts = message.attempts + 1;
      const exhausted = permanent || attempts >= MAX_ATTEMPTS;

      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: {
          // Un error permanente no se reintenta: sólo gastaría cuota.
          status: exhausted ? 'FAILED' : 'PENDING',
          attempts,
          lastError: err instanceof Error ? err.message.slice(0, 1000) : 'Error desconocido',
        },
      });

      logger.warn(
        { messageId: message.publicId, attempts, permanent },
        'No se pudo enviar un aviso al cliente',
      );
      failed += 1;
    }
  }

  return { sent, failed };
}

/** Registra que el cliente escribió, para saber si hay ventana de 24 horas. */
export async function recordInboundMessage(
  commerceId: number,
  phoneE164: string,
): Promise<void> {
  await prisma.customer.updateMany({
    where: { commerceId, phoneE164 },
    data: { lastInboundAt: new Date() },
  });
}

export { Prisma };
