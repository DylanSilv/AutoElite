import { describe, expect, it } from 'vitest';
import { InvalidPhoneError, formatPhone, normalizePhone } from './phone.js';

/**
 * El formato del teléfono decide si, en la fase 2, el agente reconoce a un
 * cliente que ya existe. Estos casos son los que realmente tipea el personal.
 */
describe('normalizePhone', () => {
  // El 9 es parte del E.164 argentino para móviles: es el formato exacto en el
  // que WhatsApp entrega el número, que es con lo que hay que matchear.
  it.each([
    ['11 4567-8901', '+5491145678901'],
    ['1145678901', '+5491145678901'],
    ['011 4567-8901', '+5491145678901'],
    ['(011) 4567-8901', '+5491145678901'],
    ['11 15 4567-8901', '+5491145678901'],
    ['011 15 4567 8901', '+5491145678901'],
    ['+54 9 11 4567-8901', '+5491145678901'],
    ['+5491145678901', '+5491145678901'],
    ['005491145678901', '+5491145678901'],
    ['5491145678901', '+5491145678901'],
  ])('normaliza %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('respeta un número internacional de otro país', () => {
    expect(normalizePhone('+56 9 1234 5678')).toBe('+56912345678');
  });

  it('rechaza lo que no parece un teléfono', () => {
    expect(() => normalizePhone('123')).toThrow(InvalidPhoneError);
    expect(() => normalizePhone('   ')).toThrow(InvalidPhoneError);
  });

  it('dos formas de escribir el mismo número dan la misma identidad', () => {
    // El punto de todo esto: que no se dupliquen fichas de clientes.
    expect(normalizePhone('11 15 4567-8901')).toBe(normalizePhone('011 4567 8901'));
  });
});

describe('formatPhone', () => {
  it('devuelve un formato legible', () => {
    expect(formatPhone('+5491145678901')).toBe('+54 9 11 4567-8901');
  });

  it('deja pasar lo que no reconoce', () => {
    expect(formatPhone('+56912345678')).toBe('+56912345678');
  });
});
