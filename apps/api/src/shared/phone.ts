/**
 * Normalización de teléfonos a E.164.
 *
 * Importa más de lo que parece: en la fase 2 WhatsApp entrega el número como
 * `+5491134567890`. Si durante meses el personal cargó "15 3456-7890" y
 * "(011) 4567-8901", el agente no va a poder reconocer a un cliente que ya
 * existe y se van a duplicar fichas e historiales.
 *
 * Cobertura: formatos argentinos habituales. Un número que ya viene en E.164 se
 * respeta tal cual, así que otros países funcionan si se los escribe con "+".
 */

const AR_COUNTRY_CODE = '54';

export class InvalidPhoneError extends Error {
  constructor(readonly raw: string) {
    super(`No se pudo interpretar el teléfono "${raw}"`);
  }
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Devuelve el número en E.164 (con "+") o lanza si no parece un teléfono.
 *
 * Reglas para Argentina:
 * - Se descarta el 0 de larga distancia y el 15 de celular.
 * - Se antepone el 9 que la numeración internacional exige para móviles.
 */
export function normalizePhone(raw: string, countryCode = AR_COUNTRY_CODE): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidPhoneError(raw);

  // Ya viene en formato internacional: se respeta.
  if (trimmed.startsWith('+')) {
    const digits = digitsOf(trimmed);
    if (digits.length < 8) throw new InvalidPhoneError(raw);
    return `+${digits}`;
  }

  let digits = digitsOf(trimmed);
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Ya trae el código de país.
  if (digits.startsWith(countryCode) && digits.length >= 12) {
    return `+${digits}`;
  }

  // 0 de larga distancia: 011 4567-8901 → 11 4567-8901
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');

  // 15 de celular después del código de área: 11 15 3456-7890 → 11 3456-7890
  const withoutFifteen = digits.match(/^(\d{2,4})15(\d{6,8})$/);
  if (withoutFifteen) {
    digits = `${withoutFifteen[1]}${withoutFifteen[2]}`;
  }

  if (digits.length < 8) throw new InvalidPhoneError(raw);

  if (countryCode === AR_COUNTRY_CODE) {
    // El 9 marca móvil en la numeración internacional argentina, y es el
    // formato en el que WhatsApp entrega el número. Se asume móvil porque es
    // prácticamente el único caso en pedidos: un fijo cargado así quedaría con
    // un 9 de más, pero no se usa para contactar, sólo como identidad interna.
    return `+${countryCode}9${digits}`;
  }
  return `+${countryCode}${digits}`;
}

/** Versión que no lanza, para búsquedas donde un teléfono inválido sólo no encuentra nada. */
export function tryNormalizePhone(raw: string, countryCode = AR_COUNTRY_CODE): string | null {
  try {
    return normalizePhone(raw, countryCode);
  } catch {
    return null;
  }
}

/** Formato legible para el panel: +54 9 11 3456-7890. */
export function formatPhone(e164: string): string {
  const match = e164.match(/^\+549(\d{2,4})(\d{4})(\d{4})$/);
  if (!match) return e164;
  return `+54 9 ${match[1]} ${match[2]}-${match[3]}`;
}
