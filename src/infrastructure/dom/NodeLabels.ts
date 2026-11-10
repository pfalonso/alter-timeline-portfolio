import type { SelectionViewState, TimelineViewModel } from '../../application/ports';
import type { ProjectedFrame, ProjectionListener } from '../three/types';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { labelDistanceLimit, layoutLabels, type Box, type LabelCandidate, type Obstacle } from './labelLayout';

interface Label {
  readonly element: HTMLElement;
  readonly width: number;
  shown: boolean;
}

const LABEL_HEIGHT = 34;

/** Rótulos DOM (tipografía nítida) que siguen a los nodos de la escena. Decorativos: aria-hidden. */
export class NodeLabels implements TimelineViewPart, ProjectionListener {
  private readonly labels = new Map<string, Label>();
  private focusedId: string | null = null;

  private reserved: Box[] = [];
  private frames = 0;

  constructor(
    private readonly root: HTMLElement,
    /** Elementos de interfaz que los rótulos no deben pisar (cabecera, filtros…). */
    private readonly keepClear: readonly HTMLElement[] = [],
  ) {
    root.setAttribute('aria-hidden', 'true');
  }

  /** Mide las zonas reservadas solo de vez en cuando: leer el layout cada fotograma sale caro. */
  private refreshReserved(): void {
    const origin = this.root.getBoundingClientRect();
    this.reserved = this.keepClear
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - origin.left,
        right: rect.right - origin.left,
        top: rect.top - origin.top,
        bottom: rect.bottom - origin.top,
      }));
  }

  render(model: TimelineViewModel): void {
    clear(this.root);
    this.labels.clear();
    for (const event of model.timeline.events) {
      const element = el('div', { class: `node-label node-label--i${event.importance}` }, [
        el('span', { class: 'node-label__title', text: event.title }),
        el('span', { class: 'node-label__date', text: String(event.start.year) }),
      ]);
      element.style.setProperty('--accent', model.timeline.primaryCategoryOf(event)?.color ?? '#ffffff');
      this.root.append(element);
      // Estimación de ancho (evita medir el DOM cada fotograma); el CSS limita el máximo.
      const perChar = event.importance === 3 ? 8.6 : 7;
      this.labels.set(event.id, { element, width: Math.min(230, event.title.length * perChar + 18), shown: false });
    }
  }

  applySelection(state: SelectionViewState): void {
    this.focusedId = state.focusedEventId;
  }

  onProjected(frame: ProjectedFrame): void {
    if (this.frames % 20 === 0) this.refreshReserved();
    this.frames += 1;
    const candidates: LabelCandidate[] = [];
    const obstacles: Obstacle[] = [];
    for (const node of frame.nodes) {
      const label = this.labels.get(node.eventId);
      if (!label || !node.inFront) continue;
      if (node.presence > 0.5) obstacles.push({ id: node.eventId, x: node.x, y: node.y, radius: node.radius * 1.5 });
      const pinned = node.highlighted || node.eventId === this.focusedId;
      const eligible = node.presence > 0.5 && (pinned || frame.cameraDistance <= labelDistanceLimit(node.importance));
      if (!eligible) continue;
      const gap = node.radius * 2.1 + 10;
      candidates.push({
        id: node.eventId,
        x: node.x,
        ys: [node.y + gap, node.y - gap - LABEL_HEIGHT],
        width: label.width,
        height: LABEL_HEIGHT,
        priority: (pinned ? 100 : 0) + node.importance * 10 + node.radius * 0.01,
      });
    }
    const placed = layoutLabels(candidates, frame.viewport, obstacles, this.reserved);
    const xById = new Map(candidates.map((candidate) => [candidate.id, candidate.x]));
    for (const [id, label] of this.labels) {
      const y = placed.get(id);
      const visible = y !== undefined;
      if (visible !== label.shown) {
        label.shown = visible;
        label.element.classList.toggle('node-label--shown', visible);
      }
      label.element.classList.toggle('node-label--focused', id === this.focusedId);
      if (y !== undefined) {
        label.element.style.transform = `translate3d(${(xById.get(id) ?? 0).toFixed(1)}px, ${y.toFixed(1)}px, 0) translateX(-50%)`;
      }
    }
  }
}
