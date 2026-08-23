import { describe, expect, it } from 'vitest';
import { InvalidPhoneError, formatPhone, normalizePhone } from './phone.js';

/**
 * El formato del teléfono decide si el agente de WhatsApp reconoce a un cliente
 * que ya existe. Estos son los casos que realmente tipea el personal.
 */
describe('normalizePhone · Uruguay', () => {
  it.each([
    ['099 123 456', '+59899123456'],
    ['099123456', '+59899123456'],
    ['99 123 456', '+59899123456'],
    ['(099) 123-456', '+59899123456'],
    ['+598 99 123 456', '+59899123456'],
    ['+59899123456', '+59899123456'],
    ['0059899123456', '+59899123456'],
    ['59899123456', '+59899123456'],
    // Fijo de Montevideo.
    ['2712 3456', '+59827123456'],
  ])('normaliza %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('no inserta dígitos extra en el número nacional', () => {
    // Argentina antepone un 9 para móviles; Uruguay no, porque el 9 ya es parte
    // del prefijo. Meter uno de más daría un número inexistente.
    const e164 = normalizePhone('099 123 456');
    expect(e164.replace('+598', '')).toBe('99123456');
  });

  it('dos formas de escribir el mismo número dan la misma identidad', () => {
    expect(normalizePhone('099 123 456')).toBe(normalizePhone('99123456'));
  });

  it('rechaza lo que no parece un teléfono', () => {
    expect(() => normalizePhone('123')).toThrow(InvalidPhoneError);
    expect(() => normalizePhone('   ')).toThrow(InvalidPhoneError);
  });

  it('respeta un número internacional de otro país', () => {
    expect(normalizePhone('+55 11 91234 5678')).toBe('+5511912345678');
  });
});

describe('normalizePhone · Argentina', () => {
  it.each([
    ['11 4567-8901', '+5491145678901'],
    ['011 4567-8901', '+5491145678901'],
    ['11 15 4567-8901', '+5491145678901'],
    ['+54 9 11 4567-8901', '+5491145678901'],
  ])('normaliza %s', (input, expected) => {
    expect(normalizePhone(input, 'AR')).toBe(expected);
  });
});

describe('formatPhone', () => {
  it('formatea un móvil uruguayo', () => {
    expect(formatPhone('+59899123456')).toBe('+598 99 123 456');
  });

  it('formatea un móvil argentino', () => {
    expect(formatPhone('+5491145678901')).toBe('+54 9 11 4567-8901');
  });

  it('deja pasar lo que no reconoce', () => {
    expect(formatPhone('+5511912345678')).toBe('+5511912345678');
  });
});
