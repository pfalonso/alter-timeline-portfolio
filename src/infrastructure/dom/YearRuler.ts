import type { TimelineViewModel } from '../../application/ports';
import type { ProjectedFrame, ProjectionListener } from '../three/types';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { yearStep } from './labelLayout';
import { STRINGS } from './strings';

/** Regla inferior con las marcas de año, alineada con los meridianos de la escena. */
export class YearRuler implements TimelineViewPart, ProjectionListener {
  private readonly ticks = new Map<number, HTMLElement>();
  private readonly now = el('div', { class: 'ruler__now', text: STRINGS.today });

  constructor(private readonly root: HTMLElement) {
    root.setAttribute('aria-hidden', 'true');
  }

  render(model: TimelineViewModel): void {
    clear(this.root);
    this.ticks.clear();
    for (const mark of model.layout.years) {
      const tick = el('div', { class: 'ruler__tick' }, [el('span', { text: String(mark.year) })]);
      this.ticks.set(mark.year, tick);
      this.root.append(tick);
    }
    this.root.append(this.now);
  }

  onProjected(frame: ProjectedFrame): void {
    const { years, viewport } = frame;
    const pixelsPerYear = years.length >= 2 ? Math.abs(years[years.length - 1].x - years[0].x) / (years.length - 1) : 100;
    const step = yearStep(pixelsPerYear);
    for (const mark of years) {
      const tick = this.ticks.get(mark.year);
      if (!tick) continue;
      const onScreen = mark.inFront && mark.x >= 24 && mark.x <= viewport.width - 24;
      tick.hidden = !onScreen;
      if (!onScreen) continue;
      tick.classList.toggle('ruler__tick--minor', mark.year % step !== 0);
      tick.style.transform = `translate3d(${mark.x.toFixed(1)}px, 0, 0)`;
    }
    const nowVisible = frame.nowX !== null && frame.nowX >= 24 && frame.nowX <= viewport.width - 24;
    this.now.hidden = !nowVisible;
    if (nowVisible && frame.nowX !== null) this.now.style.transform = `translate3d(${frame.nowX.toFixed(1)}px, 0, 0)`;
  }
}
