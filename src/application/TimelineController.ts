import { CategorySelection, type Timeline } from '../domain/model';
import type { EventFilter } from '../domain/services';
import type {
  FilterStateStore,
  NavigationDirection,
  NavigationGranularity,
  StoryViewState,
  TimelineView,
  TimelineViewHandlers,
} from './ports';
import {
  FollowStory,
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
  /** Reglas del modo historia (por defecto, `FollowStory`). */
  readonly followStory?: FollowStory;
}

/** Paso actual del modo historia. */
interface StoryState {
  readonly eventId: string;
  readonly fromEventId: string | null;
  readonly newChapter: boolean;
}

/** Orquesta casos de uso ↔ vista. Mantiene el estado de sesión (filtro y selección). */
export class TimelineController implements TimelineViewHandlers {
  private timeline: Timeline | null = null;
  private filter: CategorySelection = CategorySelection.all([]);
  private visibleIds: ReadonlySet<string> = new Set();
  private selection: SelectionState = NO_SELECTION;
  private story: StoryState | null = null;
  private readonly followStory: FollowStory;

  constructor(private readonly deps: TimelineControllerDeps) {
    this.followStory = deps.followStory ?? new FollowStory();
  }

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
    // Cerrar el detalle durante el recorrido es salir de la historia.
    this.story = null;
    this.selection = { ...this.selection, detailOpen: false };
    this.pushSelection();
  }

  onSelectionCleared(): void {
    this.story = null;
    this.select(null, false);
  }

  onNavigate(direction: NavigationDirection, granularity: NavigationGranularity = 'all'): void {
    if (!this.timeline) return;
    // En modo historia ←/→ siguen el recorrido, no la cronología.
    if (this.story) {
      this.onStoryStep(direction);
      return;
    }
    const target = this.deps.navigateEvents.execute(
      this.timeline,
      this.visibleIds,
      this.selection.focusedEventId,
      direction,
      granularity,
    );
    if (target !== null) this.select(target, this.selection.detailOpen);
  }

  onStoryStart(fromEventId?: string): void {
    if (!this.timeline) return;
    const step = this.followStory.start(this.followStory.path(this.timeline, this.visibleIds), fromEventId);
    if (step) this.goToStory(step.eventId, null);
  }

  onStoryStep(direction: NavigationDirection): void {
    if (!this.timeline) return;
    const path = this.followStory.path(this.timeline, this.visibleIds);
    const current = this.story?.eventId ?? this.selection.focusedEventId;
    const step = this.followStory.step(path, current, direction);
    if (step) this.goToStory(step.eventId, current);
  }

  onStoryExit(): void {
    if (!this.story) return;
    this.story = null;
    this.selection = { ...this.selection, detailOpen: false };
    this.pushSelection();
  }

  private goToStory(eventId: string, fromEventId: string | null): void {
    const timeline = this.timeline as Timeline;
    this.story = { eventId, fromEventId, newChapter: this.followStory.isNewChapter(timeline, fromEventId, eventId) };
    this.selection = { focusedEventId: eventId, detailOpen: true };
    this.pushSelection();
  }

  private select(eventId: string | null, openDetail: boolean): void {
    if (!this.timeline) return;
    const next = this.deps.selectEvent.execute(this.timeline, this.visibleIds, this.selection, eventId, openDetail);
    if (next.focusedEventId === this.selection.focusedEventId && next.detailOpen === this.selection.detailOpen) return;
    // Elegir otro evento durante la historia: si está en el recorrido, se sigue desde él; si no, se sale.
    if (this.story && next.focusedEventId !== this.story.eventId) {
      const path = this.followStory.path(this.timeline, this.visibleIds);
      const id = next.focusedEventId;
      this.story =
        id !== null && path.includes(id)
          ? { eventId: id, fromEventId: this.story.eventId, newChapter: this.followStory.isNewChapter(this.timeline, this.story.eventId, id) }
          : null;
    }
    this.selection = next;
    this.pushSelection();
  }

  private changeFilter(action: FilterAction): void {
    if (!this.timeline) return;
    this.filter = this.deps.toggleCategoryFilter.execute(this.filter, action);
    this.pushFilter();
    const reconciled = this.deps.selectEvent.reconcile(this.visibleIds, this.selection);
    if (reconciled !== this.selection) this.selection = reconciled;
    if (this.story && !this.visibleIds.has(this.story.eventId)) this.story = null;
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
    const path = this.followStory.path(this.timeline, this.visibleIds);
    const story = this.storyView(path);
    const focused = this.selection.focusedEventId;
    const next = story || focused === null ? null : this.followStory.step(path, focused, 'next');
    if (story) {
      this.deps.view.applySelection({
        ...this.selection,
        hasPrevious: story.index > 0,
        hasNext: story.index < story.total - 1,
        story,
      });
      return;
    }
    this.deps.view.applySelection({ ...this.selection, ...neighbours, storyNextId: next?.eventId });
  }

  private storyView(path: readonly string[]): StoryViewState | undefined {
    if (!this.story || !this.timeline) return undefined;
    const index = path.indexOf(this.story.eventId);
    if (index === -1) return undefined;
    const event = this.timeline.getEvent(this.story.eventId);
    return {
      index,
      total: path.length,
      eventId: this.story.eventId,
      fromEventId: this.story.fromEventId,
      arcId: (event && this.timeline.arcOf(event)?.id) ?? null,
      newChapter: this.story.newChapter,
    };
  }
}
