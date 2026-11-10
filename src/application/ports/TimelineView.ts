import type { Timeline } from '../../domain/model';
import type { TimelineLayoutResult } from '../../domain/services';
import type { DataSource } from './TimelineRepository';

export interface TimelineViewModel {
  readonly timeline: Timeline;
  readonly layout: TimelineLayoutResult;
  readonly source: DataSource;
}

export interface FilterViewState {
  readonly activeCategoryIds: ReadonlySet<string>;
  readonly visibleEventIds: ReadonlySet<string>;
  readonly totalEvents: number;
}

export interface SelectionViewState {
  /** Evento enfocado (la cámara vuela a él); `null` si ninguno. */
  readonly focusedEventId: string | null;
  /** `true` si el pop-up de detalle está abierto para el evento enfocado. */
  readonly detailOpen: boolean;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

export type NavigationDirection = 'previous' | 'next';

/** Intenciones del usuario que la vista comunica al controlador. */
export interface TimelineViewHandlers {
  onCategoryToggled(categoryId: string): void;
  onCategorySoloed(categoryId: string): void;
  onAllCategories(): void;
  onNoCategories(): void;
  /** Abrir el detalle de un evento (clic / Enter). */
  onEventActivated(eventId: string): void;
  onDetailClosed(): void;
  /** Quitar el foco del evento actual (clic en el vacío). */
  onSelectionCleared(): void;
  onNavigate(direction: NavigationDirection): void;
}

/** Puerto de salida: todo lo que la aplicación necesita pintar. */
export interface TimelineView {
  bind(handlers: TimelineViewHandlers): void;
  render(model: TimelineViewModel): void;
  applyFilter(state: FilterViewState): void;
  applySelection(state: SelectionViewState): void;
  showLoadError(message: string): void;
}
