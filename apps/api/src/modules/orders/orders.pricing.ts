import type { OrderTotals } from '@autoelite/shared';

/**
 * Cálculo de totales: única fuente de verdad.
 *
 *   lineTotal = (precio de la variante + Σ deltas de modificadores) × cantidad
 *   subtotal  = Σ lineTotal
 *   total     = subtotal + envío − descuento
 *
 * Es una función pura y se usa tanto en `POST /orders/quote` como en
 * `POST /orders`, para que el número que ve el operador en pantalla sea
 * exactamente el que se guarda. Ni el panel ni el agente calculan su propia
 * versión.
 */

export interface PricedModifier {
  name: string;
  priceDeltaCents: number;
  optionId: number | null;
}

export interface PricedLine {
  productId: number | null;
  variantId: number | null;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  notes: string | null;
  modifiers: PricedModifier[];
  lineTotalCents: number;
}

export function computeLineTotal(
  unitPriceCents: number,
  modifiers: { priceDeltaCents: number }[],
  quantity: number,
): number {
  const modifiersTotal = modifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0);
  return (unitPriceCents + modifiersTotal) * quantity;
}

export function computeTotals(
  lines: PricedLine[],
  deliveryFeeCents: number,
  discountCents: number,
): OrderTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

  // El total nunca puede ser negativo: un descuento mayor al pedido es un error
  // de carga, no una devolución.
  const totalCents = Math.max(0, subtotalCents + deliveryFeeCents - discountCents);

  return { subtotalCents, deliveryFeeCents, discountCents, totalCents };
}
