/**
 * Normalización de teléfonos a E.164.
 *
 * Importa más de lo que parece: WhatsApp entrega el número del cliente en este
 * formato. Si el personal cargó "099 123 456" y el agente recibe
 * "+59899123456", sin normalizar serían dos clientes distintos y se duplicarían
 * fichas e historiales.
 *
 * Las reglas dependen del país porque los planes de numeración difieren de
 * verdad: Uruguay antepone el código de país al número sin el 0 de larga
 * distancia, mientras que Argentina además exige un 9 para móviles y admite un
 * 15 que hay que descartar.
 */

export type CountryCode = 'UY' | 'AR';

export const DEFAULT_COUNTRY: CountryCode = 'UY';

interface CountryRules {
  /** Prefijo internacional, sin el "+". */
  dialCode: string;
  /** Largo mínimo del número nacional, ya sin prefijos. */
  minNationalDigits: number;
  /** Ajustes propios del plan de numeración, aplicados al número nacional. */
  normalizeNational?: (digits: string) => string;
  /** Se antepone al número nacional dentro del E.164. */
  mobilePrefix?: string;
}

const RULES: Record<CountryCode, CountryRules> = {
  // Uruguay: móviles 09X XXX XXX, fijos de Montevideo 2XXX XXXX.
  // Se descarta el 0 de larga distancia y no hay ningún dígito extra.
  UY: {
    dialCode: '598',
    minNationalDigits: 8,
  },
  // Argentina: se descarta el 0 de larga distancia y el 15 de celular, y se
  // antepone el 9 que la numeración internacional exige para móviles.
  AR: {
    dialCode: '54',
    minNationalDigits: 8,
    mobilePrefix: '9',
    normalizeNational: (digits) => {
      const withoutFifteen = digits.match(/^(\d{2,4})15(\d{6,8})$/);
      return withoutFifteen ? `${withoutFifteen[1]}${withoutFifteen[2]}` : digits;
    },
  },
};

export class InvalidPhoneError extends Error {
  constructor(readonly raw: string) {
    super(`No se pudo interpretar el teléfono "${raw}"`);
  }
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

export function isSupportedCountry(value: string): value is CountryCode {
  return value in RULES;
}

/** Devuelve el número en E.164 (con "+") o lanza si no parece un teléfono. */
export function normalizePhone(raw: string, country: CountryCode = DEFAULT_COUNTRY): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidPhoneError(raw);

  const rules = RULES[country];

  // Ya viene en formato internacional: se respeta tal cual, así funcionan los
  // números de cualquier país sin tener que modelarlos todos.
  if (trimmed.startsWith('+')) {
    const digits = digitsOf(trimmed);
    if (digits.length < 8) throw new InvalidPhoneError(raw);
    return `+${digits}`;
  }

  let digits = digitsOf(trimmed);
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Ya trae el código de país delante.
  if (digits.startsWith(rules.dialCode)) {
    const national = digits.slice(rules.dialCode.length);
    if (national.length >= rules.minNationalDigits) return `+${digits}`;
  }

  // 0 de larga distancia.
  digits = digits.replace(/^0+/, '');
  if (rules.normalizeNational) digits = rules.normalizeNational(digits);

  if (digits.length < rules.minNationalDigits) throw new InvalidPhoneError(raw);

  return `+${rules.dialCode}${rules.mobilePrefix ?? ''}${digits}`;
}

/** Versión que no lanza, para búsquedas donde un teléfono inválido sólo no encuentra nada. */
export function tryNormalizePhone(
  raw: string,
  country: CountryCode = DEFAULT_COUNTRY,
): string | null {
  try {
    return normalizePhone(raw, country);
  } catch {
    return null;
  }
}

/** Formato legible para el panel: +598 99 123 456. */
export function formatPhone(e164: string): string {
  const uruguay = e164.match(/^\+598(\d{1,2})(\d{3})(\d{3})$/);
  if (uruguay) return `+598 ${uruguay[1]} ${uruguay[2]} ${uruguay[3]}`;

  const argentina = e164.match(/^\+549(\d{2,4})(\d{4})(\d{4})$/);
  if (argentina) return `+54 9 ${argentina[1]} ${argentina[2]}-${argentina[3]}`;

  return e164;
}
