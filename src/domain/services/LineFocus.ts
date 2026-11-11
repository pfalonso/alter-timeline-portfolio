import type { FocusLevel, LifeLine } from '../model/LifeLine';
import { PartialDate } from '../model/PartialDate';

/** Intensidad fuera de foco y en cada nivel de foco (0..1). */
export const FOCUS_OUT = 0.3;
export const FOCUS_LEVEL_INTENSITY: Readonly<Record<FocusLevel, number>> = { 1: 0.55, 2: 0.78, 3: 1 };
/** Años que dura la transición (centrada en cada borde del periodo). */
export const FOCUS_TRANSITION_YEARS = 0.8;

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Intensidad (0..1) de una línea vital en un instante (año decimal o fecha). Sin periodos de foco
 * la línea brilla siempre a pleno (1, el comportamiento clásico). Con periodos: `FOCUS_OUT` fuera
 * de ellos y el valor de su nivel dentro, con transiciones suaves en los bordes. Si dos periodos se
 * solapan, manda el más intenso. Función pura.
 */
export function focusIntensityAt(line: Pick<LifeLine, 'focus'> | undefined, date: number | PartialDate): number {
  if (!line || line.focus.length === 0) return 1;
  const year = date instanceof PartialDate ? date.toDecimalYear() : date;
  const half = FOCUS_TRANSITION_YEARS / 2;
  let best = FOCUS_OUT;
  for (const period of line.focus) {
    const start = period.start.toDecimalYear();
    const rise = smoothstep((year - (start - half)) / FOCUS_TRANSITION_YEARS);
    const fall = period.end === null ? 1 : 1 - smoothstep((year - (period.end.toDecimalYearEnd() - half)) / FOCUS_TRANSITION_YEARS);
    const level = FOCUS_LEVEL_INTENSITY[period.level];
    best = Math.max(best, FOCUS_OUT + (level - FOCUS_OUT) * Math.min(rise, fall));
  }
  return Math.round(best * 1000) / 1000;
}

/** Muestrea la intensidad de foco en varios instantes (p. ej. uno por punto de la curva). */
export function sampleFocus(line: Pick<LifeLine, 'focus'> | undefined, years: readonly number[]): number[] {
  return years.map((year) => focusIntensityAt(line, year));
}
