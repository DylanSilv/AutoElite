import { formatMoney } from '@autoelite/shared';

/** Único lugar donde se formatea dinero: ningún componente divide por 100. */
export const money = (cents: number) => formatMoney(cents);

const timeFormatter = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
});

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
});

const fullFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
});

export const time = (iso: string) => timeFormatter.format(new Date(iso));
export const date = (iso: string) => dateFormatter.format(new Date(iso));
export const dateTime = (iso: string) => fullFormatter.format(new Date(iso));

/**
 * Minutos transcurridos desde que entró el pedido.
 *
 * Es lo que evita que un pedido se pierda: uno pendiente hace 25 minutos tiene
 * que verse distinto de uno que acaba de entrar.
 */
export function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

export function elapsedLabel(iso: string): string {
  const minutes = minutesSince(iso);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}
