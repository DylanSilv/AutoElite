import { describe, expect, it } from 'vitest';
import { computeLineTotal, computeTotals, type PricedLine } from './orders.pricing.js';

function line(overrides: Partial<PricedLine> = {}): PricedLine {
  const base: PricedLine = {
    productId: 1,
    variantId: 1,
    productName: 'Muzzarella',
    variantName: 'Grande',
    unitPriceCents: 1_450_000,
    quantity: 1,
    notes: null,
    modifiers: [],
    lineTotalCents: 1_450_000,
  };
  return { ...base, ...overrides };
}

describe('computeLineTotal', () => {
  it('multiplica precio por cantidad', () => {
    expect(computeLineTotal(1_450_000, [], 3)).toBe(4_350_000);
  });

  it('suma los modificadores antes de multiplicar', () => {
    // Dos pizzas con huevo: el extra se cobra por unidad, no por pedido.
    const total = computeLineTotal(1_450_000, [{ priceDeltaCents: 90_000 }], 2);
    expect(total).toBe(3_080_000);
  });

  it('acepta modificadores que restan', () => {
    expect(computeLineTotal(1_000_000, [{ priceDeltaCents: -100_000 }], 1)).toBe(900_000);
  });
});

describe('computeTotals', () => {
  it('suma subtotal, envío y descuento', () => {
    const totals = computeTotals(
      [line({ lineTotalCents: 1_450_000 }), line({ lineTotalCents: 350_000 })],
      150_000,
      100_000,
    );

    expect(totals.subtotalCents).toBe(1_800_000);
    expect(totals.deliveryFeeCents).toBe(150_000);
    expect(totals.discountCents).toBe(100_000);
    expect(totals.totalCents).toBe(1_850_000);
  });

  it('no permite un total negativo', () => {
    // Un descuento mayor al pedido es un error de carga, no una devolución.
    const totals = computeTotals([line({ lineTotalCents: 100_000 })], 0, 500_000);
    expect(totals.totalCents).toBe(0);
  });

  it('un pedido vacío da cero', () => {
    expect(computeTotals([], 0, 0).totalCents).toBe(0);
  });

  it('mantiene exactitud con montos que en float fallarían', () => {
    // 0.1 + 0.2 en pesos: con floats daría 0.30000000000000004.
    const totals = computeTotals(
      [line({ lineTotalCents: 10 }), line({ lineTotalCents: 20 })],
      0,
      0,
    );
    expect(totals.totalCents).toBe(30);
  });

  it('el envío se suma una sola vez, no por línea', () => {
    const totals = computeTotals(
      [line({ lineTotalCents: 100 }), line({ lineTotalCents: 100 }), line({ lineTotalCents: 100 })],
      250_000,
      0,
    );
    expect(totals.totalCents).toBe(250_300);
  });
});
