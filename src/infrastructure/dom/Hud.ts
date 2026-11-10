import type { FilterViewState, SelectionViewState, TimelineViewModel } from '../../application/ports';
import type { TimelineViewPart } from './CompositeTimelineView';
import { append, clear, el, safeLink } from './dom';
import { STRINGS } from './strings';

/** Cabecera: nombre, titular, tagline, contacto, contador de eventos y aviso de datos de ejemplo. */
export class Hud implements TimelineViewPart {
  private readonly counter = el('p', { class: 'hud__counter', attrs: { 'aria-live': 'polite' } });

  constructor(private readonly root: HTMLElement) {}

  render(model: TimelineViewModel): void {
    const { meta } = model.timeline;
    clear(this.root);
    document.title = `${meta.owner} — ${meta.title}`;
    document.documentElement.lang = meta.locale;

    const contact = el('ul', { class: 'hud__contact' });
    for (const item of meta.contact ?? []) {
      const link = safeLink(item.label, item.url);
      if (link) contact.append(el('li', {}, [link]));
    }

    append(
      this.root,
      el('p', { class: 'hud__eyebrow', text: meta.title }),
      el('h1', { class: 'hud__owner', text: meta.owner }),
      meta.tagline ? el('p', { class: 'hud__tagline', text: meta.tagline }) : null,
      el('div', { class: 'hud__meta' }, [
        this.counter,
        model.source === 'example'
          ? el('p', {
              class: 'hud__notice',
              text: STRINGS.exampleData,
              attrs: { title: STRINGS.exampleDataHint, role: 'status', 'data-testid': 'example-notice' },
            })
          : null,
      ]),
      contact.childElementCount > 0 ? contact : null,
    );
  }

  applyFilter(state: FilterViewState): void {
    this.counter.textContent = STRINGS.eventsVisible(state.visibleEventIds.size, state.totalEvents);
  }

  /** Con el detalle abierto la cabecera se retira para no competir con la escena. */
  applySelection(state: SelectionViewState): void {
    this.root.classList.toggle('hud--dimmed', state.detailOpen);
  }

  showLoadError(message: string): void {
    clear(this.root);
    this.root.append(
      el('h1', { class: 'hud__owner', text: STRINGS.loadError }),
      el('p', { class: 'hud__tagline', text: message, attrs: { role: 'alert' } }),
    );
  }
}
