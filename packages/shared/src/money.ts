/**
 * El dinero se representa siempre como entero en centavos.
 *
 * `0.1 + 0.2 !== 0.3`: con floats, un pedido de veinte líneas termina cerrando
 * con un centavo de diferencia respecto de la caja. Los centavos enteros hacen
 * la aritmética exacta, y el formateo pasa por un único lugar.
 */

export function formatMoney(cents: number, currency = 'ARS', locale = 'es-AR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** "12.500,50" o "12500.5" → 1250050. Devuelve null si no es un número. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return null;

  // Se asume formato local (es-AR): el punto separa miles y la coma decimales.
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function centsToUnits(cents: number): number {
  return Math.round(cents) / 100;
}
