import { formatMoney } from '@autoelite/shared';
import type { MessageKind, Order, OrderStatus, OrderType } from '@prisma/client';

/**
 * Textos de los avisos automáticos.
 *
 * Están acá y no dispersos por el código de pedidos porque son la voz del
 * comercio hacia sus clientes: tienen que poder revisarse y ajustarse de un
 * vistazo, sin leer lógica de negocio.
 *
 * Se evita prometer tiempos que el sistema no conoce: un "llega en 30 minutos"
 * inventado genera más reclamos que no decir nada.
 */

export interface MessageContext {
  order: Pick<
    Order,
    | 'number'
    | 'type'
    | 'customerName'
    | 'totalCents'
    | 'deliveryStreet'
    | 'deliveryNumber'
    | 'cancelReason'
  >;
  commerce: { name: string; currency: string; address?: string | null };
}

/** Primer nombre: "Hola Martina" suena mejor que "Hola Martina Silva". */
function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : '';
}

function greeting(name: string): string {
  const first = firstName(name);
  return first ? `¡Hola ${first}!` : '¡Hola!';
}

/**
 * Qué aviso corresponde a cada transición.
 *
 * Devuelve null cuando no hay nada que avisar: el cliente no necesita un
 * mensaje por cada movimiento interno de la cocina.
 */
export function kindForTransition(status: OrderStatus, type: OrderType): MessageKind | null {
  switch (status) {
    case 'PENDIENTE':
      return 'ORDER_RECEIVED';
    case 'CONFIRMADO':
      return 'ORDER_CONFIRMED';
    case 'LISTO':
      // "Listo" significa cosas distintas según la modalidad: en un envío el
      // pedido todavía no salió, así que avisarle al cliente que "está listo"
      // lo haría salir a la puerta al pedo.
      if (type === 'DELIVERY') return null;
      return type === 'TAKEAWAY' ? 'ORDER_READY_PICKUP' : 'ORDER_READY_DINE_IN';
    case 'EN_CAMINO':
      return 'ORDER_ON_THE_WAY';
    case 'CANCELADO':
      return 'ORDER_CANCELLED';
    default:
      return null;
  }
}

export function buildMessageBody(kind: MessageKind, ctx: MessageContext): string {
  const { order, commerce } = ctx;
  const total = formatMoney(order.totalCents, commerce.currency, 'es-UY');
  const hola = greeting(order.customerName);
  const numero = `#${order.number}`;

  switch (kind) {
    case 'ORDER_RECEIVED':
      return (
        `${hola} Recibimos tu pedido ${numero} en ${commerce.name}.\n` +
        `Total: ${total}\n\n` +
        'Te avisamos apenas lo confirmemos. ¡Gracias!'
      );

    case 'ORDER_CONFIRMED':
      return (
        `${hola} Confirmamos tu pedido ${numero} y ya lo estamos preparando 👨‍🍳\n` +
        `Total: ${total}`
      );

    case 'ORDER_READY_PICKUP':
      return (
        `${hola} Tu pedido ${numero} ya está listo para retirar 🍕\n` +
        (commerce.address ? `Te esperamos en ${commerce.address}.` : 'Te esperamos.')
      );

    case 'ORDER_READY_DINE_IN':
      return `${hola} Tu pedido ${numero} ya está listo 🍕 Enseguida te lo llevamos a la mesa.`;

    case 'ORDER_ON_THE_WAY': {
      const destino = order.deliveryStreet
        ? ` a ${order.deliveryStreet}${order.deliveryNumber ? ` ${order.deliveryNumber}` : ''}`
        : '';
      return (
        `${hola} Tu pedido ${numero} salió${destino} 🛵\n` +
        'En breve golpean la puerta.'
      );
    }

    case 'ORDER_DELIVERED':
      return `${hola} Tu pedido ${numero} fue entregado. ¡Gracias por elegirnos! 🙌`;

    case 'ORDER_CANCELLED':
      return (
        `${hola} Tu pedido ${numero} fue cancelado.\n` +
        (order.cancelReason ? `Motivo: ${order.cancelReason}\n` : '') +
        'Cualquier duda, escribinos por acá.'
      );
  }
}
