import type { TimelineViewModel } from '../../application/ports';
import type { Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { el } from './dom';
import { STRINGS } from './strings';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Quien quiera saber sobre qué nodo está el puntero. */
export interface NodeHoverListener {
  onNodeHover(eventId: string | null, at: ScreenPoint): void;
}

/** Tooltip de hover: categoría principal + título completo + fechas. */
export class Tooltip implements TimelineViewPart, NodeHoverListener {
  private timeline: Timeline | null = null;
  private readonly title = el('strong', { class: 'tooltip__title' });
  private readonly dates = el('span', { class: 'tooltip__dates' });
  private readonly category = el('span', { class: 'tooltip__category' });
  private currentId: string | null = null;

  constructor(private readonly root: HTMLElement) {
    root.setAttribute('role', 'tooltip');
    root.hidden = true;
    root.append(this.category, this.title, this.dates);
  }

  render(model: TimelineViewModel): void {
    this.timeline = model.timeline;
  }

  onNodeHover(eventId: string | null, at: ScreenPoint): void {
    const event = eventId === null ? undefined : this.timeline?.getEvent(eventId);
    if (!event || !this.timeline) {
      this.root.hidden = true;
      this.currentId = null;
      return;
    }
    if (this.currentId !== event.id) {
      this.currentId = event.id;
      const category = this.timeline.primaryCategoryOf(event);
      this.title.textContent = event.title;
      this.dates.textContent = event.formatDateRange(this.timeline.meta.locale, STRINGS.present);
      this.category.textContent = category?.label ?? '';
      this.root.style.setProperty('--accent', category?.color ?? '#ffffff');
    }
    this.root.hidden = false;
    const flip = at.x > window.innerWidth - 300;
    this.root.classList.toggle('tooltip--flip', flip);
    this.root.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0)`;
  }
}
