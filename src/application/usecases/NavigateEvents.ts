import type { Timeline } from '../../domain/model';
import type { NavigationDirection, NavigationGranularity } from '../ports';

/** Importancia mínima de los saltos «grandes» (←/→ sin Shift). */
export const MAJOR_STEP_IMPORTANCE = 2;

/**
 * Salta al evento visible anterior/siguiente en orden cronológico (sin dar la vuelta). Con
 * granularidad `major` prioriza los eventos de importancia ≥ 2 y, si ya no quedan, va al vecino.
 */
export class NavigateEvents {
  execute(
    timeline: Timeline,
    visibleEventIds: ReadonlySet<string>,
    currentEventId: string | null,
    direction: NavigationDirection,
    granularity: NavigationGranularity = 'all',
  ): string | null {
    const visible = timeline.events.filter((event) => visibleEventIds.has(event.id));
    if (visible.length === 0) return null;
    const index = currentEventId === null ? -1 : visible.findIndex((event) => event.id === currentEventId);
    const step = direction === 'next' ? 1 : -1;
    if (granularity === 'major') {
      const from = index === -1 ? (direction === 'next' ? -1 : visible.length) : index;
      for (let i = from + step; i >= 0 && i < visible.length; i += step) {
        if (visible[i].importance >= MAJOR_STEP_IMPORTANCE) return visible[i].id;
      }
    }
    if (index === -1) return (direction === 'next' ? visible[0] : visible[visible.length - 1]).id;
    const target = index + step;
    return target < 0 || target >= visible.length ? currentEventId : visible[target].id;
  }

  /** Indica si hay vecino visible en cada sentido. */
  neighbours(
    timeline: Timeline,
    visibleEventIds: ReadonlySet<string>,
    currentEventId: string | null,
  ): { hasPrevious: boolean; hasNext: boolean } {
    const visible = timeline.events.filter((event) => visibleEventIds.has(event.id));
    const index = currentEventId === null ? -1 : visible.findIndex((event) => event.id === currentEventId);
    if (index === -1) return { hasPrevious: visible.length > 0, hasNext: visible.length > 0 };
    return { hasPrevious: index > 0, hasNext: index < visible.length - 1 };
  }
}
