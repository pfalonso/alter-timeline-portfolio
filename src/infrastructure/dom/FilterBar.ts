import type { FilterViewState, TimelineViewHandlers, TimelineViewModel } from '../../application/ports';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { STRINGS } from './strings';

/** Chips de categoría (multi-selección) + "Todas / Ninguna". */
export class FilterBar implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private readonly chips = new Map<string, HTMLButtonElement>();
  private allButton: HTMLButtonElement | null = null;
  private noneButton: HTMLButtonElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    clear(this.root);
    this.chips.clear();
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', STRINGS.filtersLabel);

    const counts = model.timeline.countByCategory();
    const list = el('div', { class: 'filters__chips' });
    for (const category of model.timeline.categories) {
      const chip = el(
        'button',
        {
          class: 'chip',
          attrs: {
            type: 'button',
            'aria-pressed': 'true',
            'data-category': category.id,
            title: category.description ?? STRINGS.filterHint,
          },
        },
        [
          el('span', { class: 'chip__dot', attrs: { 'aria-hidden': 'true' } }),
          category.icon ? el('span', { class: 'chip__icon', text: category.icon, attrs: { 'aria-hidden': 'true' } }) : null,
          el('span', { class: 'chip__label', text: category.label }),
          el('span', { class: 'chip__count', text: String(counts.get(category.id) ?? 0) }),
        ],
      );
      chip.style.setProperty('--chip-color', category.color);
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
    this.allButton?.toggleAttribute('disabled', state.activeCategoryIds.size === this.chips.size);
    this.noneButton?.toggleAttribute('disabled', state.activeCategoryIds.size === 0);
  }
}
