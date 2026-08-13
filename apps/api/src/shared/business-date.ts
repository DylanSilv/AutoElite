/**
 * Día operativo.
 *
 * Una pizzería cierra a la una de la mañana: el pedido de las 00:40 del sábado
 * pertenece al viernes para la caja del negocio. Si el dashboard usara la
 * medianoche, sus números no coincidirían con los del cierre y el personal
 * dejaría de confiar en el sistema.
 *
 * Todo se guarda en UTC; la zona horaria y la hora de corte son propiedades del
 * comercio.
 */

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Algunas zonas devuelven "24" para la medianoche.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function parseCutoff(cutoff: string): { hour: number; minute: number } {
  const match = cutoff.match(/^(\d{2}):(\d{2})$/);
  if (!match) return { hour: 5, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Día operativo al que pertenece un instante, como "YYYY-MM-DD".
 *
 * Antes de la hora de corte, el instante cuenta para el día anterior.
 */
export function businessDateOf(instant: Date, timeZone: string, cutoff: string): string {
  const local = localParts(instant, timeZone);
  const { hour, minute } = parseCutoff(cutoff);

  // Se opera sobre un UTC "ficticio" con los componentes locales: alcanza para
  // sumar y restar días de calendario sin arrastrar el offset de la zona.
  const asUtc = Date.UTC(local.year, local.month - 1, local.day);
  const beforeCutoff = local.hour < hour || (local.hour === hour && local.minute < minute);
  const target = new Date(asUtc - (beforeCutoff ? 24 * 60 * 60 * 1000 : 0));

  return target.toISOString().slice(0, 10);
}

/** Fecha para columnas `@db.Date` de Prisma, que se guardan sin hora. */
export function toDateColumn(businessDate: string): Date {
  return new Date(`${businessDate}T00:00:00.000Z`);
}

export function businessDateColumnOf(instant: Date, timeZone: string, cutoff: string): Date {
  return toDateColumn(businessDateOf(instant, timeZone, cutoff));
}

/** Suma (o resta) días de calendario a un "YYYY-MM-DD". */
export function addDays(businessDate: string, days: number): string {
  const base = new Date(`${businessDate}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function formatDateColumn(date: Date): string {
  return date.toISOString().slice(0, 10);
}
