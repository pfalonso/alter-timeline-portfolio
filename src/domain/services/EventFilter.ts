import type { CategorySelection } from '../model/CategorySelection';
import type { LifeEvent } from '../model/LifeEvent';
import type { Timeline } from '../model/Timeline';

/** Decide qué eventos pasan el filtro de categorías. Puro. */
export class EventFilter {
  /** Un evento es visible si AL MENOS UNA de sus categorías está activa. */
  matches(event: LifeEvent, selection: CategorySelection): boolean {
    return event.hasAnyCategory(selection.activeIds);
  }

  /** Con `lineId`, además, solo los momentos de esa línea (los nodos de unión por los que pasa cuentan). */
  visibleEvents(timeline: Timeline, selection: CategorySelection, lineId: string | null = null): LifeEvent[] {
    return timeline.events.filter((event) => this.matches(event, selection) && (lineId === null || event.lineIds.includes(lineId)));
  }

  visibleEventIds(timeline: Timeline, selection: CategorySelection, lineId: string | null = null): Set<string> {
    return new Set(this.visibleEvents(timeline, selection, lineId).map((event) => event.id));
  }
}
