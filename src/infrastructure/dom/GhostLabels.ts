import type { FilterViewState, TimelineViewModel } from '../../application/ports';
import type { Timeline } from '../../domain/model';
import type { LayoutGhost } from '../../domain/services';
import type { ProjectedFrame, ProjectionListener } from '../three/types';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { labelDistanceLimit } from './labelLayout';

/** Separación vertical (px) entre la hebra y su rótulo. */
const OFFSET = 12;

/**
 * Rótulos de los «caminos que no fueron»: el nombre en cursiva pequeña, junto a su hebra tenue.
 * Solo al acercarse (como los nodos medios). Decorativos: aria-hidden.
 */
export class GhostLabels implements TimelineViewPart, ProjectionListener {
  private readonly labels = new Map<string, HTMLElement>();
  private timeline: Timeline | null = null;

  constructor(private readonly root: HTMLElement) {
    root.setAttribute('aria-hidden', 'true');
  }

  render(model: TimelineViewModel): void {
    this.timeline = model.timeline;
    this.build(model.layout.ghosts);
  }

  applyFilter(state: FilterViewState): void {
    if (state.layout) this.build(state.layout.ghosts);
  }

  onProjected(frame: ProjectedFrame): void {
    const near = frame.cameraDistance <= labelDistanceLimit(2);
    const seen = new Set<string>();
    for (const ghost of frame.ghosts ?? []) {
      const label = this.labels.get(ghost.id);
      if (!label) continue;
      seen.add(ghost.id);
      const visible = near && ghost.inFront && ghost.x >= 0 && ghost.x <= frame.viewport.width;
      label.classList.toggle('ghost-label--shown', visible);
      if (visible) {
        const y = ghost.y + (ghost.side > 0 ? -OFFSET : OFFSET);
        label.style.transform = `translate3d(${ghost.x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, ${ghost.side > 0 ? '-100%' : '0'})`;
      }
    }
    for (const [id, label] of this.labels) if (!seen.has(id)) label.classList.remove('ghost-label--shown');
  }

  private build(ghosts: readonly LayoutGhost[]): void {
    clear(this.root);
    this.labels.clear();
    for (const ghost of ghosts) {
      const label = el('span', { class: 'ghost-label', text: this.timeline?.getLine(ghost.id)?.label ?? ghost.id });
      label.style.setProperty('--accent', this.timeline?.lineColorOf(ghost.id) ?? '#ffffff');
      this.root.append(label);
      this.labels.set(ghost.id, label);
    }
  }
}
