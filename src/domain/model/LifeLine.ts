import type { PartialDate } from './PartialDate';

/** Lenguaje de forma de los nodos de una línea: rectilíneo (racional), orgánico (creativo) o neutro. */
export type LineStyle = 'geometric' | 'organic' | 'neutral';
export const LINE_STYLES: readonly LineStyle[] = ['geometric', 'organic', 'neutral'];

/** Estilo por defecto según el id de la línea (si no declara `style`). */
const DEFAULT_STYLE_BY_ID: Readonly<Record<string, LineStyle>> = {
  tecnologia: 'geometric',
  gestion: 'geometric',
  arte: 'organic',
  gastronomia: 'organic',
  rol: 'organic',
  vida: 'neutral',
};

export function defaultLineStyle(id: string): LineStyle {
  return DEFAULT_STYLE_BY_ID[id] ?? 'neutral';
}

export type FocusLevel = 1 | 2 | 3;
export const DEFAULT_FOCUS_LEVEL: FocusLevel = 3;

/** Periodo de foco ya normalizado. `end === null` significa «hasta hoy» (o "present"). */
export interface FocusPeriod {
  readonly start: PartialDate;
  readonly end: PartialDate | null;
  readonly level: FocusLevel;
}

export interface LineMerge {
  /** Línea en la que converge. */
  readonly branch: string;
  /** Evento de `branch` en cuya posición se produce la fusión. */
  readonly eventId: string;
}

/** Pausa ya resuelta: la línea se disuelve tras `from` y renace en `to` (fechas de inicio de ambos). */
export interface LinePause {
  readonly fromEventId: string;
  readonly toEventId: string;
  readonly from: PartialDate;
  readonly to: PartialDate;
}

/**
 * Línea vital (rama) declarada en `branches`: nombre, color, nacimiento, fusión y periodos de foco.
 * Las ramas que solo existen por `event.branch` no tienen `LifeLine`.
 */
export interface LifeLine {
  readonly id: string;
  readonly label: string;
  readonly color?: string;
  readonly description?: string;
  readonly originEventId?: string;
  readonly mergeInto?: LineMerge;
  /** `true` con `until: "present"`: la línea llega hasta hoy aunque sus eventos hayan terminado. */
  readonly untilPresent: boolean;
  readonly focus: readonly FocusPeriod[];
  /** Estilo declarado (si falta, `defaultLineStyle(id)`). */
  readonly style?: LineStyle;
  /** «Camino que no fue»: sin eventos, nace en `originEventId` y se disuelve enseguida. */
  readonly ghost: boolean;
  /** Tramos en los que la línea no se dibuja, en orden. */
  readonly pauses: readonly LinePause[];
}

/** `true` si la línea está en pausa en ese año (estrictamente entre `from` y `to`). */
export function isPausedAt(line: Pick<LifeLine, 'pauses'> | undefined, year: number): boolean {
  return (line?.pauses ?? []).some((pause) => year > pause.from.toDecimalYear() && year < pause.to.toDecimalYear());
}
