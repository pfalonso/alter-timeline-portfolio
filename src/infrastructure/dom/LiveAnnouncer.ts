import type { SelectionViewState, TimelineViewModel } from '../../application/ports';
import type { Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { STRINGS } from './strings';

/** Región aria-live: anuncia el evento enfocado al navegar con el teclado por la escena. */
export class LiveAnnouncer implements TimelineViewPart {
  private timeline: Timeline | null = null;
  private lastId: string | null = null;

  constructor(private readonly root: HTMLElement) {
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-atomic', 'true');
  }

  render(model: TimelineViewModel): void {
    this.timeline = model.timeline;
  }

  applySelection(state: SelectionViewState): void {
    if (state.focusedEventId === this.lastId) return;
    this.lastId = state.focusedEventId;
    const event = state.focusedEventId ? this.timeline?.getEvent(state.focusedEventId) : undefined;
    const story = state.story;
    const arc = story?.arcId ? this.timeline?.getArc(story.arcId)?.title ?? null : null;
    const prefix = story ? `${STRINGS.storyAnnounce(STRINGS.storyProgressLabel(story.index, story.total), arc, event?.bridge)}. ` : '';
    this.root.textContent = event
      ? `${prefix}${event.title}. ${event.formatDateRange(this.timeline?.meta.locale, STRINGS.present)}. ${event.summary}`
      : '';
  }
}
