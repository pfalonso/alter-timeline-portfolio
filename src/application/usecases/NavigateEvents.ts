import type { Timeline } from '../../domain/model';
import type { NavigationDirection } from '../ports';

/** Salta al evento visible anterior/siguiente en orden cronológico (sin dar la vuelta). */
export class NavigateEvents {
  execute(
    timeline: Timeline,
    visibleEventIds: ReadonlySet<string>,
    currentEventId: string | null,
    direction: NavigationDirection,
  ): string | null {
    const visible = timeline.events.filter((event) => visibleEventIds.has(event.id));
    if (visible.length === 0) return null;
    const index = currentEventId === null ? -1 : visible.findIndex((event) => event.id === currentEventId);
    if (index === -1) return (direction === 'next' ? visible[0] : visible[visible.length - 1]).id;
    const target = index + (direction === 'next' ? 1 : -1);
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
