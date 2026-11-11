import type { FilterViewState, TimelineViewModel } from '../../application/ports';
import type { YearMark } from '../../domain/services';
import type { ProjectedFrame, ProjectionListener } from '../three/types';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { STRINGS } from './strings';

/** Separación mínima (px) entre dos años rotulados. */
export const MIN_YEAR_GAP = 52;

/** Prioridad de un año al faltar sitio: décadas, lustros, pares y el resto. */
const yearRank = (year: number): number => (year % 10 === 0 ? 3 : year % 5 === 0 ? 2 : year % 2 === 0 ? 1 : 0);

/**
 * Regla inferior. El eje es ordinal: hay una marca donde cambia el año entre nodos consecutivos,
 * centrada en el primer nodo de ese año. Si no caben todas, se rotulan antes décadas, lustros…
 */
export class YearRuler implements TimelineViewPart, ProjectionListener {
  private readonly ticks = new Map<number, HTMLElement>();
  private readonly now = el('div', { class: 'ruler__now', text: STRINGS.today });

  constructor(private readonly root: HTMLElement) {
    root.setAttribute('aria-hidden', 'true');
  }

  render(model: TimelineViewModel): void {
    this.paint(model.layout.years);
  }

  applyFilter(state: FilterViewState): void {
    if (state.layout) this.paint(state.layout.years);
  }

  private paint(years: readonly YearMark[]): void {
    clear(this.root);
    this.ticks.clear();
    for (const mark of years) {
      const tick = el('div', { class: 'ruler__tick' }, [el('span', { text: String(mark.year) })]);
      this.ticks.set(mark.year, tick);
      this.root.append(tick);
    }
    this.root.append(this.now);
  }

  onProjected(frame: ProjectedFrame): void {
    const { years, viewport } = frame;
    const candidates = years.filter((mark) => this.ticks.has(mark.year) && mark.inFront && mark.x >= 24 && mark.x <= viewport.width - 24);
    const placed: number[] = [];
    const shown = new Set<number>();
    for (const mark of [...candidates].sort((a, b) => yearRank(b.year) - yearRank(a.year) || a.x - b.x)) {
      if (placed.some((x) => Math.abs(x - mark.x) < MIN_YEAR_GAP)) continue;
      placed.push(mark.x);
      shown.add(mark.year);
    }
    for (const [year, tick] of this.ticks) tick.hidden = !shown.has(year);
    for (const mark of candidates) {
      if (!shown.has(mark.year)) continue;
      (this.ticks.get(mark.year) as HTMLElement).style.transform = `translate3d(${mark.x.toFixed(1)}px, 0, 0)`;
    }
    const nowVisible = frame.nowX !== null && frame.nowX >= 24 && frame.nowX <= viewport.width - 24;
    this.now.hidden = !nowVisible;
    if (nowVisible && frame.nowX !== null) this.now.style.transform = `translate3d(${frame.nowX.toFixed(1)}px, 0, 0)`;
  }
}
