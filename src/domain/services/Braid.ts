import type { LifeLine } from '../model/LifeLine';
import type { Timeline } from '../model/Timeline';

/**
 * La trenza central: en cada instante viajan juntas por el centro las líneas vitales que están en
 * foco (`branches[].focus`). Si ninguna lo está, la trenza es la línea central (`mainBranch`). Una
 * línea que se fusiona (`mergeInto`) termina dentro de la trenza y ya no sale: si su último periodo
 * de foco llega hasta la fusión (o no tiene eventos entre el final del periodo y la fusión), sigue en
 * la trenza desde que empezó ese periodo; si no, vuelve a su carril y se une justo antes de la
 * fusión (eso lo resuelve el layout). Funciones puras.
 */
export type BraidSource = Pick<Timeline, 'mainBranch' | 'branchIds' | 'getLine' | 'mergeOf' | 'eventsOfBranch'>;

/** Margen para evaluar «justo antes» y «justo después» de un borde. */
const EDGE = 1e-4;

/** `true` si la fecha cae dentro de algún periodo de foco declarado (cualquier nivel). */
export function isFocusedAt(line: Pick<LifeLine, 'focus'> | undefined, year: number): boolean {
  if (!line) return false;
  return line.focus.some(
    (period) => year >= period.start.toDecimalYear() && (period.end === null || year < period.end.toDecimalYearEnd()),
  );
}

/** Año de la fusión de una línea (fecha del evento destino), si se fusiona. */
function mergeYear(source: BraidSource, id: string): number | null {
  return source.mergeOf(id)?.event.start.toDecimalYear() ?? null;
}

/**
 * Inicio de la absorción de una línea que se fusiona: el de su último periodo de foco anterior a la
 * fusión, si ese periodo llega a la fusión o la línea no tiene eventos entre su final y la fusión.
 */
function absorbedFrom(source: BraidSource, id: string): number | null {
  const merge = mergeYear(source, id);
  if (merge === null) return null;
  const periods = (source.getLine(id)?.focus ?? []).filter((period) => period.start.toDecimalYear() <= merge);
  if (periods.length === 0) return null;
  const last = periods.reduce((a, b) => (b.start.toDecimalYear() > a.start.toDecimalYear() ? b : a));
  const end = last.end === null ? Infinity : last.end.toDecimalYearEnd();
  const between = source.eventsOfBranch(id).some((event) => {
    const year = event.start.toDecimalYear();
    return year >= end && year < merge;
  });
  return end >= merge || !between ? last.start.toDecimalYear() : null;
}

/** Foco propio de una línea en un año (sin la regla de la línea central por defecto). */
function ownFocus(source: BraidSource, id: string, year: number): boolean {
  const merge = mergeYear(source, id);
  // En la fecha de la fusión ya forma parte de la línea destino.
  if (merge !== null && year >= merge) return false;
  const absorbed = absorbedFrom(source, id);
  if (absorbed !== null && year >= absorbed) return true;
  return isFocusedAt(source.getLine(id), year);
}

/** Líneas que forman la trenza en un año, en el orden de `branchIds`. Nunca vacía. */
export function braidMembersAt(source: BraidSource, year: number): string[] {
  const members = source.branchIds.filter((id) => ownFocus(source, id, year));
  return members.length > 0 ? members : [source.mainBranch];
}

/** `true` si la línea viaja por la trenza en ese año. */
export function isInBraidAt(source: BraidSource, id: string, year: number): boolean {
  return braidMembersAt(source, year).includes(id);
}

/** Años en los que puede cambiar la composición de la trenza (bordes de foco y fusiones), ordenados. */
export function braidBoundaries(source: BraidSource): number[] {
  const years = new Set<number>();
  for (const id of source.branchIds) {
    for (const period of source.getLine(id)?.focus ?? []) {
      years.add(period.start.toDecimalYear());
      if (period.end !== null) years.add(period.end.toDecimalYearEnd());
    }
    const merge = mergeYear(source, id);
    if (merge !== null) years.add(merge);
  }
  return [...years].sort((a, b) => a - b);
}

/** Cambio de estado de una línea: entra en la trenza (`join`) o sale de ella (`split`). */
export interface BraidChange {
  readonly year: number;
  readonly kind: 'join' | 'split';
}

/** Entradas y salidas de una línea en la trenza entre dos años (bordes excluidos), en orden. */
export function braidChangesOf(source: BraidSource, id: string, from: number, to: number): BraidChange[] {
  const changes: BraidChange[] = [];
  // Una línea que se fusiona termina en la fusión: no «sale» de la trenza en ese instante.
  const end = mergeYear(source, id) ?? Infinity;
  for (const year of braidBoundaries(source)) {
    if (year <= from || year > to || year >= end) continue;
    const before = isInBraidAt(source, id, year - EDGE);
    const after = isInBraidAt(source, id, year + EDGE);
    if (before !== after) changes.push({ year, kind: after ? 'join' : 'split' });
  }
  return changes;
}
