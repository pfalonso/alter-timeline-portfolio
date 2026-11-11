import type { PartialDate } from './PartialDate';

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
}
