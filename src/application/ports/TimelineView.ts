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
  /** Disposición de los eventos visibles (eje ordinal): cambia con los filtros. */
  readonly layout?: TimelineLayoutResult;
}

/** Estado del modo historia (recorrido guiado por `story.path`). */
export interface StoryViewState {
  /** Posición (0…total−1) del evento actual dentro del recorrido visible. */
  readonly index: number;
  readonly total: number;
  readonly eventId: string;
  /** Evento del que se viene (para trazar el vuelo); `null` al entrar. */
  readonly fromEventId: string | null;
  /** Arco del evento actual, si lo hay. */
  readonly arcId: string | null;
  /** `true` si este paso entra en un arco distinto del anterior (tarjeta de capítulo). */
  readonly newChapter: boolean;
}

export interface SelectionViewState {
  /** Evento enfocado (la cámara vuela a él); `null` si ninguno. */
  readonly focusedEventId: string | null;
  /** `true` si el pop-up de detalle está abierto para el evento enfocado. */
  readonly detailOpen: boolean;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** Presente solo en modo historia. */
  readonly story?: StoryViewState;
  /** Fuera del modo historia: siguiente evento del recorrido si el enfocado forma parte de él. */
  readonly storyNextId?: string;
}

export type NavigationDirection = 'previous' | 'next';
/** `major`: salta al siguiente evento de importancia ≥ 2; `all`: nodo a nodo. */
export type NavigationGranularity = 'major' | 'all';

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
  onNavigate(direction: NavigationDirection, granularity?: NavigationGranularity): void;
  /** Entra en el modo historia (desde el principio o desde un evento del recorrido). */
  onStoryStart(fromEventId?: string): void;
  /** Paso del recorrido; fuera del modo historia entra en él desde el evento enfocado. */
  onStoryStep(direction: NavigationDirection): void;
  onStoryExit(): void;
}

/** Puerto de salida: todo lo que la aplicación necesita pintar. */
export interface TimelineView {
  bind(handlers: TimelineViewHandlers): void;
  render(model: TimelineViewModel): void;
  applyFilter(state: FilterViewState): void;
  applySelection(state: SelectionViewState): void;
  showLoadError(message: string): void;
}
