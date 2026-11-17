import type {
  FilterViewState,
  SelectionViewState,
  TimelineViewHandlers,
  TimelineViewModel,
} from '../../application/ports';
import { arcYears, type LifeEvent, type Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { icon } from './icons';
import { STRINGS } from './strings';

/**
 * Índice de momentos en DOM: alternativa accesible (teclado / lector de pantalla) a la escena 3D y
 * contenido principal cuando no hay WebGL. Cabecera fija con los capítulos como saltos y un
 * interruptor «ver todos» (por defecto, solo hitos y momentos medios); filas compactas: año ·
 * título · punto del color de su línea, con peso tipográfico según la importancia.
 */
export class EventList implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private readonly items = new Map<string, { item: HTMLLIElement; button: HTMLButtonElement }>();
  private readonly list = el('ol', { class: 'index__list' });
  private readonly chapters = el('nav', { class: 'index__chapters', attrs: { 'aria-label': STRINGS.indexChapters } });
  private readonly allToggle = el('button', { class: 'index__all', attrs: { type: 'button', 'aria-pressed': 'false' }, text: STRINGS.indexAll });
  private readonly closeButton = el('button', {
    class: 'index__close',
    attrs: { type: 'button', 'aria-label': STRINGS.indexClose, title: STRINGS.indexClose },
  }, [icon('close')]);
  private main = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly toggleButton: HTMLButtonElement | null = null,
  ) {
    root.setAttribute('aria-label', STRINGS.indexTitle);
    root.classList.add('index--major');
    root.append(
      el('div', { class: 'index__head' }, [
        el('div', { class: 'index__top' }, [el('h2', { class: 'index__title', text: STRINGS.indexTitle }), this.allToggle, this.closeButton]),
        this.chapters,
      ]),
      this.list,
    );
    this.allToggle.addEventListener('click', () => this.showAll(this.allToggle.getAttribute('aria-pressed') !== 'true'));
    this.closeButton.addEventListener('click', () => {
      this.setOpen(false);
      this.toggleButton?.focus();
    });
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', String(!root.hidden));
      toggleButton.addEventListener('click', () => this.setOpen(this.root.hidden !== false));
    }
    // Los enlaces de salto (`<a href="#index">`) apuntan a un panel que empieza oculto: un salto
    // de ancla normal no haría nada, así que se abre el índice y se lleva el foco a la lista.
    if (root.id) {
      for (const link of root.ownerDocument.querySelectorAll('a[href^="#"]')) {
        if (link.getAttribute('href') !== `#${root.id}`) continue;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          this.setOpen(true);
        });
      }
    }
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.toggleButton && !this.root.hidden && !this.main) {
        event.stopPropagation();
        this.setOpen(false);
        this.toggleButton.focus();
      }
    });
  }

  /** Modo sin WebGL: la lista pasa a ser el contenido principal y no se puede cerrar. */
  showAsMainContent(message: string): void {
    this.main = true;
    this.root.hidden = false;
    this.root.classList.add('index--main');
    this.root.prepend(el('p', { class: 'index__fallback', text: message, attrs: { role: 'status' } }));
    this.closeButton.hidden = true;
    if (this.toggleButton) this.toggleButton.hidden = true;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    this.toggleButton?.setAttribute('aria-expanded', String(open));
    if (open) this.list.querySelector<HTMLElement>('.index__item:not(.index__item--minor) button:not([disabled])')?.focus();
  }

  /** Muestra también los momentos menores (o vuelve a solo hitos y medios). */
  showAll(all: boolean): void {
    this.allToggle.setAttribute('aria-pressed', String(all));
    this.allToggle.textContent = all ? STRINGS.indexMajor : STRINGS.indexAll;
    this.root.classList.toggle('index--major', !all);
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    clear(this.list);
    clear(this.chapters);
    this.items.clear();
    const { timeline } = model;
    this.allToggle.hidden = !timeline.events.some((event) => event.importance < 2);
    // Con arcos, los momentos se agrupan por capítulo (en orden cronológico): un encabezado por grupo.
    let group: HTMLElement = this.list;
    let groupKey: string | null | undefined;
    for (const event of timeline.events) {
      if (timeline.arcs.length > 0) {
        const arc = timeline.arcOf(event);
        const key = arc?.id ?? null;
        if (key !== groupKey) {
          groupKey = key;
          group = el('ol', { class: 'index__group-list' });
          const headingId = `index-arc-${arc?.id ?? 'otros'}`;
          const heading = el('h3', { class: 'index__group-title', attrs: { id: headingId, tabindex: '-1' } }, [
            el('span', { text: arc ? arc.title : STRINGS.outsideArcs }),
            arc ? el('span', { class: 'index__group-years', text: arcYears(arc, STRINGS.today) }) : null,
          ]);
          const groupItem = el('li', { class: 'index__group' }, [
            heading,
            arc?.summary ? el('p', { class: 'index__group-summary', text: arc.summary }) : null,
            group,
          ]);
          if (arc) {
            groupItem.dataset.arc = arc.id;
            const index = timeline.arcs.indexOf(arc);
            const jump = el('button', { class: 'index__jump', attrs: { type: 'button', title: arc.title } }, [
              el('span', { class: 'index__jump-number', text: String(index + 1) }),
              el('span', { class: 'index__jump-title', text: arc.title }),
            ]);
            jump.addEventListener('click', () => {
              heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
              heading.focus({ preventScroll: true });
            });
            this.chapters.append(jump);
          }
          this.list.append(groupItem);
        }
      }
      const { item, button } = this.row(timeline, event);
      this.items.set(event.id, { item, button });
      group.append(item);
    }
    this.chapters.hidden = this.chapters.childElementCount === 0;
  }

  private row(timeline: Timeline, event: LifeEvent): { item: HTMLLIElement; button: HTMLButtonElement } {
    const line = timeline.getLine(event.branch);
    const color = timeline.lineColorOf(event.branch) ?? timeline.primaryCategoryOf(event)?.color ?? '#ffffff';
    const button = el('button', { class: 'index__button', attrs: { type: 'button' } }, [
      el('span', { class: 'index__dot', attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'index__date', text: event.formatDateRange(timeline.meta.locale, STRINGS.present) }),
      el('span', { class: 'index__name', text: event.title }),
      event.subtitle ? el('span', { class: 'index__subtitle', text: event.subtitle }) : null,
      line ? el('span', { class: 'index__line visually-hidden', text: STRINGS.lineOf(line.label) }) : null,
      el('span', { class: 'index__summary', text: event.summary }),
    ]);
    button.style.setProperty('--accent', color);
    button.addEventListener('click', () => this.handlers?.onEventActivated(event.id));
    const item = el('li', { class: `index__item index__item--i${event.importance}${event.importance < 2 ? ' index__item--minor' : ''}` }, [button]);
    return { item, button };
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
