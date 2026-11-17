import type { FilterViewState, TimelineViewHandlers, TimelineViewModel } from '../../application/ports';
import type { Timeline } from '../../domain/model';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { STRINGS } from './strings';

/**
 * Resultado del filtro en lenguaje natural, junto a los filtros y solo cuando hay alguno activo
 * («Mostrando 73 de 80 momentos · Mostrar todo»). Sin filtros no se muestra nada.
 */
export class FilterSummary implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private timeline: Timeline | null = null;
  private readonly text = el('span', { class: 'filters__result-text' });
  private readonly reset = el('button', { class: 'filters__reset', text: STRINGS.resetFilters, attrs: { type: 'button' } });

  constructor(private readonly root: HTMLElement) {
    root.hidden = true;
    root.setAttribute('aria-live', 'polite');
    clear(root);
    root.append(this.text, this.reset);
    this.reset.addEventListener('click', () => this.handlers?.onFiltersReset());
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    this.timeline = model.timeline;
  }

  applyFilter(state: FilterViewState): void {
    const visible = state.visibleEventIds.size;
    const total = state.totalEvents;
    const isolated = state.isolatedLine ?? null;
    const filtered = visible < total || isolated !== null;
    this.root.hidden = !filtered;
    if (!filtered) {
      this.text.textContent = '';
      return;
    }
    const label = isolated !== null ? (this.timeline?.getLine(isolated)?.label ?? isolated) : null;
    this.text.textContent = label !== null ? STRINGS.isolatedResult(label, visible, total) : STRINGS.filterResult(visible, total);
  }
}
