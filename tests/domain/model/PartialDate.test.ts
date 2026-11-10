import { describe, expect, it } from 'vitest';
import { InvalidDateError } from '../../../src/domain/errors';
import { PartialDate } from '../../../src/domain/model';

describe('PartialDate.tryParse / parse', () => {
  it('reconoce la precisión según el formato', () => {
    expect(PartialDate.parse('2019')).toMatchObject({ year: 2019, month: null, day: null, precision: 'year' });
    expect(PartialDate.parse('2019-03')).toMatchObject({ year: 2019, month: 3, day: null, precision: 'month' });
    expect(PartialDate.parse('2019-03-14')).toMatchObject({ year: 2019, month: 3, day: 14, precision: 'day' });
  });

  it.each([
    ['mes 00', '2019-00'],
    ['mes 13', '2019-13'],
    ['día 00', '2019-03-00'],
    ['día 32', '2019-03-32'],
    ['30 de febrero', '2019-02-30'],
    ['29 de febrero en año no bisiesto', '2019-02-29'],
    ['año de tres cifras', '999'],
    ['año anterior al 1000', '0999'],
    ['mes de una cifra', '2019-3'],
    ['separador incorrecto', '2019/03'],
    ['espacios', ' 2019'],
    ['texto', 'present'],
    ['cadena vacía', ''],
    ['fecha ISO con hora', '2019-03-14T10:00:00Z'],
  ])('rechaza %s (%s)', (_label, raw) => {
    expect(PartialDate.tryParse(raw)).toBeNull();
  });

  it('acepta el 29 de febrero en año bisiesto', () => {
    expect(PartialDate.tryParse('2020-02-29')?.toString()).toBe('2020-02-29');
    expect(PartialDate.tryParse('2000-02-29')).not.toBeNull();
    expect(PartialDate.tryParse('1900-02-29')).toBeNull();
  });

  it.each([[2019], [null], [undefined], [{}], [['2019']]])('tryParse devuelve null si no es texto (%j)', (raw) => {
    expect(PartialDate.tryParse(raw)).toBeNull();
  });

  it('parse lanza InvalidDateError con el valor original', () => {
    let caught: unknown;
    try {
      PartialDate.parse('ayer');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidDateError);
    expect((caught as InvalidDateError).raw).toBe('ayer');
    expect((caught as InvalidDateError).message).toContain('"ayer"');
  });
});

describe('PartialDate: conversiones', () => {
  it('fromDate usa la fecha UTC', () => {
    const date = PartialDate.fromDate(new Date(Date.UTC(2026, 10, 10, 23, 59)));
    expect(date.toString()).toBe('2026-11-10');
    expect(date.precision).toBe('day');
  });

  it('toString rellena con ceros', () => {
    expect(PartialDate.parse('2019').toString()).toBe('2019');
    expect(PartialDate.parse('2019-03').toString()).toBe('2019-03');
    expect(PartialDate.parse('2019-03-04').toString()).toBe('2019-03-04');
  });

  it('toDecimalYear es el inicio del periodo', () => {
    expect(PartialDate.parse('2019').toDecimalYear()).toBe(2019);
    expect(PartialDate.parse('2019-01').toDecimalYear()).toBe(2019);
    expect(PartialDate.parse('2019-01-01').toDecimalYear()).toBe(2019);
    expect(PartialDate.parse('2019-02').toDecimalYear()).toBeCloseTo(2019 + 31 / 365, 10);
    expect(PartialDate.parse('2019-12-31').toDecimalYear()).toBeCloseTo(2019 + 364 / 365, 10);
  });

  it('toDecimalYear tiene en cuenta los años bisiestos', () => {
    expect(PartialDate.parse('2020-03').toDecimalYear()).toBeCloseTo(2020 + 60 / 366, 10);
    expect(PartialDate.parse('2019-03').toDecimalYear()).toBeCloseTo(2019 + 59 / 365, 10);
  });

  it('toDecimalYearEnd es el final del periodo según la precisión', () => {
    expect(PartialDate.parse('2019').toDecimalYearEnd()).toBe(2020);
    expect(PartialDate.parse('2019-03').toDecimalYearEnd()).toBeCloseTo(PartialDate.parse('2019-04').toDecimalYear(), 10);
    expect(PartialDate.parse('2019-12').toDecimalYearEnd()).toBe(2020);
    expect(PartialDate.parse('2019-03-14').toDecimalYearEnd()).toBeCloseTo(
      PartialDate.parse('2019-03-15').toDecimalYear(),
      10,
    );
    expect(PartialDate.parse('2019-12-31').toDecimalYearEnd()).toBeCloseTo(2020, 10);
  });
});

describe('PartialDate: comparación', () => {
  it('compareTo ordena por año, mes y día (lo que falta cuenta como 1)', () => {
    const d = PartialDate.parse;
    expect(d('2018').compareTo(d('2019'))).toBeLessThan(0);
    expect(d('2019-05').compareTo(d('2019-03'))).toBeGreaterThan(0);
    expect(d('2019-03-02').compareTo(d('2019-03-10'))).toBeLessThan(0);
    expect(d('2019').compareTo(d('2019-01-01'))).toBe(0);
    expect(d('2019').compareTo(d('2019-02'))).toBeLessThan(0);
  });

  it('equals exige la misma precisión', () => {
    expect(PartialDate.parse('2019-03').equals(PartialDate.parse('2019-03'))).toBe(true);
    expect(PartialDate.parse('2019').equals(PartialDate.parse('2019-01'))).toBe(false);
    expect(PartialDate.parse('2019-03-01').equals(PartialDate.parse('2019-03'))).toBe(false);
  });

  it('isDefinitelyBefore respeta la precisión: un año contiene a sus meses', () => {
    const d = PartialDate.parse;
    expect(d('2018').isDefinitelyBefore(d('2019'))).toBe(true);
    expect(d('2019').isDefinitelyBefore(d('2019-03'))).toBe(false);
    expect(d('2019-02').isDefinitelyBefore(d('2019-03'))).toBe(true);
    expect(d('2019-03').isDefinitelyBefore(d('2019-03-14'))).toBe(false);
    expect(d('2019-03-13').isDefinitelyBefore(d('2019-03-14'))).toBe(true);
    expect(d('2019-03-14').isDefinitelyBefore(d('2019-03-14'))).toBe(false);
    expect(d('2020').isDefinitelyBefore(d('2019'))).toBe(false);
  });
});

describe('PartialDate.format', () => {
  it('un año se muestra tal cual', () => {
    expect(PartialDate.parse('2019').format('es')).toBe('2019');
  });

  it('mes y día se formatean con el locale indicado, en UTC', () => {
    expect(PartialDate.parse('2019-03').format('en')).toBe('Mar 2019');
    expect(PartialDate.parse('2019-03-14').format('en')).toBe('Mar 14, 2019');
    expect(PartialDate.parse('2019-03').format('es')).toMatch(/^mar\.? 2019$/);
    expect(PartialDate.parse('2019-01-01').format()).toMatch(/^1 ene\.? 2019$/);
  });

  it('con un locale inválido cae a la forma ISO', () => {
    expect(PartialDate.parse('2019-03').format('esto no es un locale')).toBe('2019-03');
    expect(PartialDate.parse('2019-03-14').format('!!')).toBe('2019-03-14');
  });
});
