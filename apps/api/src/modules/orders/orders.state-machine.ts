import { allowedTransitions, type OrderStatus, type OrderType } from '@autoelite/shared';
import { BusinessRuleError, ConflictError } from '../../shared/errors.js';

/**
 * Transiciones de estado.
 *
 * Vive en un único lugar para que ningún camino —panel, agente, n8n— pueda
 * saltarse las reglas. `EN_CAMINO` sólo existe para envíos, y por eso las
 * transiciones dependen también del tipo de pedido.
 */

export { allowedTransitions };

/** Estados terminales: deshacer un error se hace cancelando y recreando. */
export function isTerminal(status: OrderStatus): boolean {
  return status === 'ENTREGADO' || status === 'CANCELADO';
}

/**
 * Verifica que el estado actual sea el que el cliente creía.
 *
 * En una pizzería a las nueve de la noche dos personas abren el mismo pedido.
 * Sin este control, el último clic gana en silencio y se pierde información;
 * con él, el segundo recibe un 409 y la UI puede explicar qué pasó.
 */
export function assertExpectedStatus(current: OrderStatus, expected: OrderStatus): void {
  if (current !== expected) {
    throw new ConflictError(
      'CONFLICT',
      'El pedido ya cambió de estado; actualizá la pantalla antes de reintentar',
      { currentStatus: current, expectedStatus: expected },
    );
  }
}

export function assertTransitionAllowed(
  current: OrderStatus,
  next: OrderStatus,
  type: OrderType,
): void {
  const allowed = allowedTransitions(current, type);
  if (!allowed.includes(next)) {
    throw new BusinessRuleError(
      'VALIDATION_ERROR',
      `No se puede pasar de ${current} a ${next}`,
      { currentStatus: current, allowed },
    );
  }
}
