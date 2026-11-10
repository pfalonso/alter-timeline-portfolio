import { CategorySelection, type Timeline } from '../domain/model';
import type { EventFilter } from '../domain/services';
import type {
  FilterStateStore,
  NavigationDirection,
  TimelineView,
  TimelineViewHandlers,
} from './ports';
import {
  NO_SELECTION,
  type FilterAction,
  type LoadTimeline,
  type NavigateEvents,
  type SelectEvent,
  type SelectionState,
  type ToggleCategoryFilter,
} from './usecases';

export interface TimelineControllerDeps {
  readonly view: TimelineView;
  readonly filterStore: FilterStateStore;
  readonly eventFilter: EventFilter;
  readonly loadTimeline: LoadTimeline;
  readonly toggleCategoryFilter: ToggleCategoryFilter;
  readonly selectEvent: SelectEvent;
  readonly navigateEvents: NavigateEvents;
}

/** Orquesta casos de uso ↔ vista. Mantiene el estado de sesión (filtro y selección). */
export class TimelineController implements TimelineViewHandlers {
  private timeline: Timeline | null = null;
  private filter: CategorySelection = CategorySelection.all([]);
  private visibleIds: ReadonlySet<string> = new Set();
  private selection: SelectionState = NO_SELECTION;

  constructor(private readonly deps: TimelineControllerDeps) {}

  /** Carga los datos y pinta el estado inicial. Devuelve `false` si la carga falla. */
  async start(): Promise<boolean> {
    this.deps.view.bind(this);
    try {
      const model = await this.deps.loadTimeline.execute();
      this.timeline = model.timeline;
      this.filter = CategorySelection.of(
        model.timeline.categories.map((category) => category.id),
        this.deps.filterStore.load(),
      );
      this.deps.view.render(model);
      this.pushFilter();
      this.pushSelection();
      return true;
    } catch (error) {
      this.deps.view.showLoadError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  onCategoryToggled(categoryId: string): void {
    this.changeFilter({ type: 'toggle', categoryId });
  }

  onCategorySoloed(categoryId: string): void {
    this.changeFilter({ type: 'only', categoryId });
  }

  onAllCategories(): void {
    this.changeFilter({ type: 'all' });
  }

  onNoCategories(): void {
    this.changeFilter({ type: 'none' });
  }

  onEventActivated(eventId: string): void {
    this.select(eventId, true);
  }

  onDetailClosed(): void {
    if (!this.selection.detailOpen) return;
    this.selection = { ...this.selection, detailOpen: false };
    this.pushSelection();
  }

  onSelectionCleared(): void {
    this.select(null, false);
  }

  onNavigate(direction: NavigationDirection): void {
    if (!this.timeline) return;
    const target = this.deps.navigateEvents.execute(
      this.timeline,
      this.visibleIds,
      this.selection.focusedEventId,
      direction,
    );
    if (target !== null) this.select(target, this.selection.detailOpen);
  }

  private select(eventId: string | null, openDetail: boolean): void {
    if (!this.timeline) return;
    const next = this.deps.selectEvent.execute(this.timeline, this.visibleIds, this.selection, eventId, openDetail);
    if (next.focusedEventId === this.selection.focusedEventId && next.detailOpen === this.selection.detailOpen) return;
    this.selection = next;
    this.pushSelection();
  }

  private changeFilter(action: FilterAction): void {
    if (!this.timeline) return;
    this.filter = this.deps.toggleCategoryFilter.execute(this.filter, action);
    this.pushFilter();
    const reconciled = this.deps.selectEvent.reconcile(this.visibleIds, this.selection);
    if (reconciled !== this.selection) this.selection = reconciled;
    this.pushSelection();
  }

  private pushFilter(): void {
    if (!this.timeline) return;
    this.visibleIds = this.deps.eventFilter.visibleEventIds(this.timeline, this.filter);
    this.deps.view.applyFilter({
      activeCategoryIds: this.filter.activeIds,
      visibleEventIds: this.visibleIds,
      totalEvents: this.timeline.events.length,
    });
  }

  private pushSelection(): void {
    if (!this.timeline) return;
    const neighbours = this.deps.navigateEvents.neighbours(
      this.timeline,
      this.visibleIds,
      this.selection.focusedEventId,
    );
    this.deps.view.applySelection({ ...this.selection, ...neighbours });
  }
}
