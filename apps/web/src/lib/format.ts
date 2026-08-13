import { formatMoney } from '@autoelite/shared';

/**
 * Formateo de moneda y fechas.
 *
 * La moneda y la zona horaria son propiedades del comercio, no constantes del
 * panel: la plataforma tiene que poder servir a un comercio uruguayo y a uno de
 * otro país sin tocar código. Se configuran al iniciar sesión, con lo que
 * devuelve `/auth/me`.
 */

interface FormattingSettings {
  currency: string;
  timeZone: string;
  locale: string;
}

/** Se usa hasta que llegan los datos del comercio. */
const DEFAULTS: FormattingSettings = {
  currency: 'UYU',
  timeZone: 'America/Montevideo',
  locale: 'es-UY',
};

const LOCALE_BY_CURRENCY: Record<string, string> = {
  UYU: 'es-UY',
  ARS: 'es-AR',
  BRL: 'pt-BR',
  USD: 'en-US',
};

let settings = DEFAULTS;
let formatters = buildFormatters(DEFAULTS);

function buildFormatters({ locale, timeZone }: FormattingSettings) {
  return {
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }),
    date: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone }),
    full: new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }),
  };
}

export function configureFormatting(commerce: { currency: string; timezone: string }): void {
  settings = {
    currency: commerce.currency,
    timeZone: commerce.timezone,
    locale: LOCALE_BY_CURRENCY[commerce.currency] ?? DEFAULTS.locale,
  };
  formatters = buildFormatters(settings);
}

/** Único lugar donde se formatea dinero: ningún componente divide por 100. */
export const money = (cents: number) => formatMoney(cents, settings.currency, settings.locale);

export const time = (iso: string) => formatters.time.format(new Date(iso));
export const date = (iso: string) => formatters.date.format(new Date(iso));
export const dateTime = (iso: string) => formatters.full.format(new Date(iso));

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
