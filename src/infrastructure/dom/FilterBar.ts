import type { FilterViewState, TimelineViewHandlers, TimelineViewModel } from '../../application/ports';
import type { LineStyle, Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { icon } from './icons';
import { STRINGS } from './strings';

export interface FilterBarOptions {
  /** Botón «Más filtros» que despliega el panel (segundo nivel). */
  readonly toggle?: HTMLButtonElement | null;
  /** Panel que se despliega (contiene los chips y las claves de lectura). Por defecto, `root`. */
  readonly panel?: HTMLElement | null;
}

/**
 * Filtro de segundo nivel: categorías en un panel plegado tras «Más filtros» (el primer nivel son
 * las líneas vitales). Chips de texto (sin emojis), multi-selección; «Mostrar todas» u «Ocultar
 * todas», solo la que aplica.
 */
export class FilterBar implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private readonly chips = new Map<string, HTMLButtonElement>();
  private allButton: HTMLButtonElement | null = null;
  private noneButton: HTMLButtonElement | null = null;
  private readonly toggle: HTMLButtonElement | null;
  private readonly panel: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    options: FilterBarOptions = {},
  ) {
    this.toggle = options.toggle ?? null;
    this.panel = options.panel ?? root;
    if (this.toggle) {
      this.panel.hidden = true;
      this.toggle.setAttribute('aria-expanded', 'false');
      if (this.panel.id) this.toggle.setAttribute('aria-controls', this.panel.id);
      this.toggle.addEventListener('click', () => this.setOpen(!this.open));
      this.panel.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        this.setOpen(false);
        this.toggle?.focus();
      });
    }
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  get open(): boolean {
    return this.panel.hidden !== true;
  }

  setOpen(open: boolean): void {
    if (!this.toggle) return;
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.toggle.classList.toggle('filters__toggle--open', open);
  }

  render(model: TimelineViewModel): void {
    clear(this.root);
    this.chips.clear();
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', STRINGS.filtersLabel);
    if (this.toggle) {
      clear(this.toggle);
      // Sin líneas vitales, las categorías son el único filtro: el botón lo dice tal cual.
      this.toggle.append(icon('filter'), el('span', { text: model.timeline.lines.length > 0 ? STRINGS.moreFilters : STRINGS.filtersOnly }));
    }

    const counts = model.timeline.countByCategory();
    const list = el('div', { class: 'filters__chips' });
    for (const category of model.timeline.categories) {
      const chip = el(
        'button',
        {
          class: 'chip',
          attrs: { type: 'button', 'aria-pressed': 'true', 'data-category': category.id, title: category.description ?? STRINGS.filterHint },
        },
        [
          el('span', { class: 'chip__check', attrs: { 'aria-hidden': 'true' } }),
          el('span', { class: 'chip__label', text: category.label }),
          el('span', { class: 'chip__count', text: String(counts.get(category.id) ?? 0) }),
        ],
      );
      chip.addEventListener('click', (event) => {
        if (event.altKey || event.detail === 2) this.handlers?.onCategorySoloed(category.id);
        else this.handlers?.onCategoryToggled(category.id);
      });
      this.chips.set(category.id, chip);
      list.append(chip);
    }

    this.allButton = el('button', { class: 'filters__bulk', text: STRINGS.all, attrs: { type: 'button' } });
    this.noneButton = el('button', { class: 'filters__bulk', text: STRINGS.none, attrs: { type: 'button' } });
    this.allButton.addEventListener('click', () => this.handlers?.onAllCategories());
    this.noneButton.addEventListener('click', () => this.handlers?.onNoCategories());

    this.root.append(
      el('div', { class: 'filters__head' }, [
        el('span', { class: 'filters__title', text: STRINGS.filtersLabel }),
        this.allButton,
        this.noneButton,
      ]),
      list,
    );
  }

  applyFilter(state: FilterViewState): void {
    for (const [id, chip] of this.chips) {
      chip.setAttribute('aria-pressed', String(state.activeCategoryIds.has(id)));
    }
    // Solo la acción que aplica: con todas activas no hay nada que «mostrar».
    if (this.allButton) this.allButton.hidden = state.activeCategoryIds.size === this.chips.size;
    if (this.noneButton) this.noneButton.hidden = state.activeCategoryIds.size === 0;
  }
}

/**
 * Lenguaje de forma de cada categoría: el de la línea en la que más eventos tiene (empate: la
 * primera en aparecer).
 */
export function dominantStyles(timeline: Timeline): Map<string, LineStyle> {
  const tally = new Map<string, Map<LineStyle, number>>();
  for (const event of timeline.events) {
    const style = timeline.lineStyleOf(event.branch);
    for (const id of event.categoryIds) {
      const counts = tally.get(id) ?? new Map<LineStyle, number>();
      counts.set(style, (counts.get(style) ?? 0) + 1);
      tally.set(id, counts);
    }
  }
  const result = new Map<string, LineStyle>();
  for (const [id, counts] of tally) {
    let best: LineStyle = 'neutral';
    let max = 0;
    for (const [style, count] of counts) {
      if (count > max) {
        best = style;
        max = count;
      }
    }
    result.set(id, best);
  }
  return result;
}
