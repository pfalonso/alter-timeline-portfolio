import type {
  FilterViewState,
  SelectionViewState,
  TimelineViewHandlers,
  TimelineViewModel,
} from '../../application/ports';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { STRINGS } from './strings';

/**
 * Índice de eventos en DOM: alternativa accesible (teclado / lector de pantalla) a la escena 3D
 * y contenido principal cuando no hay WebGL.
 */
export class EventList implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private readonly items = new Map<string, { item: HTMLLIElement; button: HTMLButtonElement }>();
  private readonly list = el('ol', { class: 'index__list' });

  constructor(
    private readonly root: HTMLElement,
    private readonly toggleButton: HTMLButtonElement | null = null,
  ) {
    root.setAttribute('aria-label', STRINGS.indexTitle);
    root.append(el('h2', { class: 'index__title', text: STRINGS.indexTitle }), this.list);
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', String(!root.hidden));
      toggleButton.addEventListener('click', () => this.setOpen(this.root.hidden !== false));
    }
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.toggleButton && !this.root.hidden) {
        event.stopPropagation();
        this.setOpen(false);
        this.toggleButton.focus();
      }
    });
  }

  /** Modo sin WebGL: la lista pasa a ser el contenido principal y no se puede cerrar. */
  showAsMainContent(message: string): void {
    this.root.hidden = false;
    this.root.classList.add('index--main');
    this.root.prepend(el('p', { class: 'index__fallback', text: message, attrs: { role: 'status' } }));
    if (this.toggleButton) this.toggleButton.hidden = true;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    this.toggleButton?.setAttribute('aria-expanded', String(open));
    if (open) this.list.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    clear(this.list);
    this.items.clear();
    const { timeline } = model;
    for (const event of timeline.events) {
      const category = timeline.primaryCategoryOf(event);
      const button = el('button', { class: 'index__button', attrs: { type: 'button' } }, [
        el('span', { class: 'index__date', text: event.formatDateRange(timeline.meta.locale, STRINGS.present) }),
        el('span', { class: 'index__name', text: event.title }),
        el('span', { class: 'index__category', text: category?.label ?? '' }),
        el('span', { class: 'index__summary', text: event.summary }),
      ]);
      button.style.setProperty('--accent', category?.color ?? '#ffffff');
      button.addEventListener('click', () => this.handlers?.onEventActivated(event.id));
      const item = el('li', { class: 'index__item' }, [button]);
      this.items.set(event.id, { item, button });
      this.list.append(item);
    }
  }

  applyFilter(state: FilterViewState): void {
    for (const [id, { item, button }] of this.items) {
      const visible = state.visibleEventIds.has(id);
      item.classList.toggle('index__item--filtered', !visible);
      button.disabled = !visible;
    }
  }

  applySelection(state: SelectionViewState): void {
    for (const [id, { button }] of this.items) {
      if (id === state.focusedEventId) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }
}
