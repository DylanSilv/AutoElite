import { describe, expect, it } from 'vitest';
import { addDays, businessDateOf } from './business-date.js';

const TZ = 'America/Argentina/Buenos_Aires';
const CUTOFF = '05:00';

/**
 * El día operativo es lo que hace que el dashboard coincida con la caja. Una
 * pizzería que cierra a la una de la mañana cuenta el pedido de las 00:40
 * dentro del día anterior.
 */
describe('businessDateOf', () => {
  it('un pedido de la tarde pertenece a su propio día', () => {
    // 2026-08-14 21:30 en Buenos Aires (UTC-3) = 2026-08-15T00:30Z
    expect(businessDateOf(new Date('2026-08-15T00:30:00Z'), TZ, CUTOFF)).toBe('2026-08-14');
  });

  it('un pedido de las 00:40 pertenece al día anterior', () => {
    // 2026-08-15 00:40 local = 2026-08-15T03:40Z
    expect(businessDateOf(new Date('2026-08-15T03:40:00Z'), TZ, CUTOFF)).toBe('2026-08-14');
  });

  it('justo antes del corte sigue siendo el día anterior', () => {
    // 04:59 local
    expect(businessDateOf(new Date('2026-08-15T07:59:00Z'), TZ, CUTOFF)).toBe('2026-08-14');
  });

  it('a partir del corte arranca el día nuevo', () => {
    // 05:00 local
    expect(businessDateOf(new Date('2026-08-15T08:00:00Z'), TZ, CUTOFF)).toBe('2026-08-15');
  });

  it('cruza el fin de mes correctamente', () => {
    // 2026-09-01 02:00 local → pertenece al 31 de agosto
    expect(businessDateOf(new Date('2026-09-01T05:00:00Z'), TZ, CUTOFF)).toBe('2026-08-31');
  });

  it('con corte a medianoche se comporta como el día calendario', () => {
    expect(businessDateOf(new Date('2026-08-15T03:40:00Z'), TZ, '00:00')).toBe('2026-08-15');
  });

  it('respeta la zona horaria del comercio', () => {
    const instant = new Date('2026-08-15T02:00:00Z');
    // 23:00 del 14 en Buenos Aires, pero ya 02:00 del 15 en Madrid.
    expect(businessDateOf(instant, TZ, CUTOFF)).toBe('2026-08-14');
    expect(businessDateOf(instant, 'Europe/Madrid', CUTOFF)).toBe('2026-08-14');
  });
});

describe('addDays', () => {
  it('suma y resta días de calendario', () => {
    expect(addDays('2026-08-14', 1)).toBe('2026-08-15');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
