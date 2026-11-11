import { describe, expect, it } from 'vitest';
import type { FocusPeriod } from '../../../src/domain/model';
import { PartialDate } from '../../../src/domain/model';
import {
  FOCUS_LEVEL_INTENSITY,
  FOCUS_OUT,
  FOCUS_TRANSITION_YEARS,
  focusIntensityAt,
  sampleFocus,
} from '../../../src/domain/services';

const period = (start: string, end: string | null, level: 1 | 2 | 3 = 3): FocusPeriod => ({
  start: PartialDate.parse(start),
  end: end === null ? null : PartialDate.parse(end),
  level,
});
const line = (...focus: FocusPeriod[]): { focus: FocusPeriod[] } => ({ focus });

describe('focusIntensityAt', () => {
  it('sin línea o sin periodos de foco la línea brilla a pleno (comportamiento clásico)', () => {
    expect(focusIntensityAt(undefined, 2010)).toBe(1);
    expect(focusIntensityAt(line(), 2010)).toBe(1);
  });

  it('fuera de foco devuelve FOCUS_OUT, dentro el valor de su nivel', () => {
    const focused = line(period('2010', '2012'));
    expect(FOCUS_OUT).toBeGreaterThanOrEqual(0.25);
    expect(FOCUS_OUT).toBeLessThanOrEqual(0.35);
    expect(focusIntensityAt(focused, 2005)).toBe(FOCUS_OUT);
    expect(focusIntensityAt(focused, 2011.5)).toBe(1);
    expect(focusIntensityAt(focused, 2020)).toBe(FOCUS_OUT);
  });

  it('los niveles 1, 2 y 3 son escalonados y el 3 llega a 1', () => {
    const values = ([1, 2, 3] as const).map((level) => focusIntensityAt(line(period('2010', '2014', level)), 2012));
    expect(values).toEqual([FOCUS_LEVEL_INTENSITY[1], FOCUS_LEVEL_INTENSITY[2], 1]);
    expect(values[0]).toBeGreaterThan(FOCUS_OUT);
    expect(values[1]).toBeGreaterThan(values[0]);
    expect(values[2]).toBeGreaterThan(values[1]);
  });

  it('la transición es suave: sin saltos y monótona en cada borde', () => {
    const focused = line(period('2010', '2012'));
    let previous = focusIntensityAt(focused, 2008);
    for (let year = 2008; year <= 2011; year += 0.02) {
      const value = focusIntensityAt(focused, year);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(Math.abs(value - previous)).toBeLessThan(0.06);
      previous = value;
    }
    // A mitad de la rampa (en el propio borde) está a medio camino.
    expect(focusIntensityAt(focused, 2010)).toBeCloseTo((FOCUS_OUT + 1) / 2, 2);
    // La caída empieza en el final del periodo (fin de 2012 = 2013.0).
    expect(focusIntensityAt(focused, 2013 - FOCUS_TRANSITION_YEARS / 2)).toBe(1);
    expect(focusIntensityAt(focused, 2013 + FOCUS_TRANSITION_YEARS / 2)).toBe(FOCUS_OUT);
  });

  it('un periodo sin fin (o "present") sigue en foco indefinidamente', () => {
    expect(focusIntensityAt(line(period('2019', null)), 2040)).toBe(1);
  });

  it('si los periodos se solapan manda el más intenso; acepta una fecha además de un año decimal', () => {
    const focused = line(period('2010', '2020', 1), period('2014', '2015', 3));
    expect(focusIntensityAt(focused, 2012)).toBe(FOCUS_LEVEL_INTENSITY[1]);
    expect(focusIntensityAt(focused, PartialDate.parse('2014-06'))).toBe(1);
  });

  it('sampleFocus muestrea varios instantes', () => {
    expect(sampleFocus(line(period('2010', '2010')), [2000, 2010.5, 2030])).toEqual([FOCUS_OUT, 1, FOCUS_OUT]);
    expect(sampleFocus(undefined, [1, 2])).toEqual([1, 1]);
  });
});
