import type { PartialDate } from './PartialDate';

/** Arco temporal (capítulo de la vida) ya normalizado. `end === null` = hasta hoy. */
export interface LifeArc {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly start: PartialDate;
  readonly end: PartialDate | null;
  readonly summary?: string;
}

/** Recorrido guiado ya normalizado: solo ids de eventos presentes en la línea temporal. */
export interface Story {
  readonly title?: string;
  readonly path: readonly string[];
}

/** Año decimal en que empieza un arco. */
export const arcStartYear = (arc: LifeArc): number => arc.start.toDecimalYear();

/** Año decimal en que termina un arco (final del periodo de `end`; `Infinity` si llega a hoy). */
export const arcEndYear = (arc: LifeArc): number => (arc.end ? arc.end.toDecimalYearEnd() : Infinity);

/** Texto de los años de un arco: "2010 — 2014", "2019 — hoy". */
export function arcYears(arc: LifeArc, presentLabel: string): string {
  const start = String(arc.start.year);
  const end = arc.end ? String(arc.end.year) : presentLabel;
  return start === end ? start : `${start} — ${end}`;
}
