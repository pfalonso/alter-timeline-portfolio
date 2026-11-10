import type { CategorySelection } from '../model/CategorySelection';
import type { LifeEvent } from '../model/LifeEvent';
import type { Timeline } from '../model/Timeline';

/** Decide qué eventos pasan el filtro de categorías. Puro. */
export class EventFilter {
  /** Un evento es visible si AL MENOS UNA de sus categorías está activa. */
  matches(event: LifeEvent, selection: CategorySelection): boolean {
    return event.hasAnyCategory(selection.activeIds);
  }

  visibleEvents(timeline: Timeline, selection: CategorySelection): LifeEvent[] {
    return timeline.events.filter((event) => this.matches(event, selection));
  }

  visibleEventIds(timeline: Timeline, selection: CategorySelection): Set<string> {
    return new Set(this.visibleEvents(timeline, selection).map((event) => event.id));
  }
}
