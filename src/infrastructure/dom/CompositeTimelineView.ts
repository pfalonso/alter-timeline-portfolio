import type {
  FilterViewState,
  SelectionViewState,
  TimelineView,
  TimelineViewHandlers,
  TimelineViewModel,
} from '../../application/ports';

/** Una pieza de la vista implementa solo lo que le interesa. */
export type TimelineViewPart = Partial<TimelineView>;

/** Reparte cada llamada del puerto `TimelineView` entre las piezas (three + overlay DOM). */
export class CompositeTimelineView implements TimelineView {
  constructor(private readonly parts: readonly TimelineViewPart[]) {}

  bind(handlers: TimelineViewHandlers): void {
    for (const part of this.parts) part.bind?.(handlers);
  }

  render(model: TimelineViewModel): void {
    for (const part of this.parts) part.render?.(model);
  }

  applyFilter(state: FilterViewState): void {
    for (const part of this.parts) part.applyFilter?.(state);
  }

  applySelection(state: SelectionViewState): void {
    for (const part of this.parts) part.applySelection?.(state);
  }

  showLoadError(message: string): void {
    for (const part of this.parts) part.showLoadError?.(message);
  }
}
