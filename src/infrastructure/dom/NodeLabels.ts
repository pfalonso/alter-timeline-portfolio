import type { FilterViewState, SelectionViewState, TimelineViewModel } from '../../application/ports';
import type { TimelineLayoutResult } from '../../domain/services';
import type { ProjectedFrame, ProjectionListener } from '../three/types';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { clampLabelX, labelDistanceLimit, labelPriority, labelSlots, layoutLabels, type Box, type LabelCandidate, type Obstacle } from './labelLayout';

interface Label {
  readonly element: HTMLElement;
  /** Tamaño en píxeles: estimado al crear y medido de verdad en cuanto el DOM tiene layout. */
  width: number;
  height: number;
  shown: boolean;
  /** Lado preferido respecto a la banda: alterna con la posición ordinal del nodo. */
  above: boolean;
  readonly importance: number;
}

/** Alto estimado por nivel (título + año); se sustituye por el medido. */
const LABEL_HEIGHT: Record<number, number> = { 1: 30, 2: 32, 3: 40 };

/** Rótulos DOM (tipografía nítida) que siguen a los nodos de la escena. Decorativos: aria-hidden. */
export class NodeLabels implements TimelineViewPart, ProjectionListener {
  private readonly labels = new Map<string, Label>();
  private focusedId: string | null = null;
  private detailOpen = false;
  private storyStep: string | undefined;

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
    // Medida real de los rótulos (la fuente display es más ancha que la estimación); a la vez que
    // las zonas reservadas, para no forzar el layout en cada fotograma.
    for (const label of this.labels.values()) {
      const width = label.element.offsetWidth;
      const height = label.element.offsetHeight;
      if (width > 0 && height > 0) {
        label.width = width;
        label.height = height;
      }
    }
  }

  render(model: TimelineViewModel): void {
    clear(this.root);
    this.labels.clear();
    model.timeline.events.forEach((event, order) => {
      const element = el('div', { class: `node-label node-label--i${event.importance}` }, [
        el('span', { class: 'node-label__title', text: event.labelTitle }),
        el('span', { class: 'node-label__date', text: String(event.start.year) }),
      ]);
      element.style.setProperty('--accent', model.timeline.primaryCategoryOf(event)?.color ?? '#ffffff');
      this.root.append(element);
      // Estimación de ancho (evita medir el DOM cada fotograma); el CSS limita el máximo.
      const perChar = event.importance === 3 ? 9.2 : 7.2;
      this.labels.set(event.id, {
        element,
        width: Math.min(event.importance === 3 ? 280 : 230, event.labelTitle.length * perChar + 18),
        height: LABEL_HEIGHT[event.importance] ?? 32,
        shown: false,
        above: order % 2 === 0,
        importance: event.importance,
      });
    });
    this.alternate(model.layout);
  }

  /** Con el eje ordinal, los rótulos alternan arriba/abajo de forma regular: nodo par arriba. */
  applyFilter(state: FilterViewState): void {
    if (state.layout) this.alternate(state.layout);
  }

  /**
   * Alterna entre los nodos que se rotulan solos (medios y mayores), en orden ordinal: dos rótulos
   * vecinos nunca compiten por el mismo lado. Los menores (solo en hover) siguen su posición.
   */
  private alternate(layout: TimelineLayoutResult): void {
    let labelled = 0;
    for (const node of layout.nodes) {
      const label = this.labels.get(node.eventId);
      if (!label) continue;
      if (label.importance >= 2) {
        label.above = labelled % 2 === 0;
        labelled += 1;
      } else {
        label.above = node.index % 2 === 0;
      }
    }
  }

  applySelection(state: SelectionViewState): void {
    this.focusedId = state.focusedEventId;
    // Abrir o cerrar el pop-up (o la tarjeta de capítulo) cambia las zonas reservadas: se vuelven
    // a medir en el próximo fotograma en vez de esperar al ciclo de 20.
    if (state.detailOpen !== this.detailOpen || state.story?.eventId !== this.storyStep) this.frames = 0;
    this.detailOpen = state.detailOpen;
    this.storyStep = state.story?.eventId;
  }

  onProjected(frame: ProjectedFrame): void {
    if (this.frames % 20 === 0) this.refreshReserved();
    this.frames += 1;
    const candidates: LabelCandidate[] = [];
    const obstacles: Obstacle[] = [];
    for (const node of frame.nodes) {
      const label = this.labels.get(node.eventId);
      if (!label || !node.inFront) continue;
      const pinned = node.highlighted || node.eventId === this.focusedId;
      // Un rótulo puede pasar por encima de un punto menor, pero nunca tapa un nodo medio o mayor.
      if (node.presence > 0.5 && (node.importance >= 2 || pinned)) {
        obstacles.push({ id: node.eventId, x: node.x, y: node.y, radius: node.radius * 1.5 });
      }
      const eligible = node.presence > 0.5 && (pinned || frame.cameraDistance <= labelDistanceLimit(node.importance));
      // Un rótulo cuyo nodo está fuera de pantalla no se pinta; si el nodo está dentro, el rótulo
      // se desplaza lo necesario para no quedar cortado por el borde.
      if (!eligible || node.x < 0 || node.x > frame.viewport.width) continue;
      const gap = node.radius * 2.1 + 10;
      candidates.push({
        id: node.eventId,
        x: clampLabelX(node.x, label.width, frame.viewport.width),
        // Alternando arriba/abajo de la banda (por posición ordinal); si no cabe, el otro lado.
        ys: labelSlots(node.y, gap, label.height, label.above),
        width: label.width,
        height: label.height,
        priority: labelPriority(node.importance, pinned, label.shown, node.radius),
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
