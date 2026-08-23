import type { OrderStatus, OrderType } from '@autoelite/shared';

/**
 * El tablero se mira de lejos y en movimiento: el estado y la modalidad tienen
 * que distinguirse por color y por ícono, no sólo por texto.
 */

type Tone = 'slate' | 'amber' | 'blue' | 'emerald' | 'violet' | 'red' | 'orange';

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDIENTE: 'amber',
  CONFIRMADO: 'blue',
  EN_PREPARACION: 'orange',
  LISTO: 'violet',
  EN_CAMINO: 'blue',
  ENTREGADO: 'emerald',
  CANCELADO: 'red',
};

export const STATUS_ACCENT: Record<OrderStatus, string> = {
  PENDIENTE: 'border-l-amber-400',
  CONFIRMADO: 'border-l-blue-400',
  EN_PREPARACION: 'border-l-orange-500',
  LISTO: 'border-l-violet-500',
  EN_CAMINO: 'border-l-sky-500',
  ENTREGADO: 'border-l-emerald-500',
  CANCELADO: 'border-l-red-400',
};

export const TYPE_ICON: Record<OrderType, string> = {
  DINE_IN: '🍽️',
  TAKEAWAY: '🛍️',
  DELIVERY: '🛵',
};

/** Texto del botón que hace avanzar el pedido, en el idioma de la cocina. */
export const TRANSITION_LABEL: Record<OrderStatus, string> = {
  PENDIENTE: 'Marcar pendiente',
  CONFIRMADO: 'Confirmar',
  EN_PREPARACION: 'A preparación',
  LISTO: 'Marcar listo',
  EN_CAMINO: 'Salió el pedido',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelar',
};

/**
 * Urgencia según cuánto lleva esperando.
 *
 * Un pedido pendiente hace media hora tiene que gritar desde la pantalla.
 */
export function urgencyClass(minutes: number, status: OrderStatus): string {
  if (status === 'ENTREGADO' || status === 'CANCELADO') return 'text-slate-400';
  if (minutes >= 30) return 'text-red-600 font-semibold';
  if (minutes >= 15) return 'text-amber-600 font-medium';
  return 'text-slate-500';
}
