import type { TimelineViewModel } from '../../application/ports';
import { arcYears } from '../../domain/model';
import type { ProjectedFrame, ProjectionListener } from '../three/types';
import type { TimelineViewPart } from './CompositeTimelineView';
import { clear, el } from './dom';
import { STRINGS } from './strings';

interface Segment {
  readonly element: HTMLElement;
  readonly caption: HTMLElement;
}

/** Ancho mínimo (px) del tramo visible de un capítulo para rotular su título. */
export const ARC_CAPTION_MIN_WIDTH = 96;
/** Por debajo de este ancho se omiten los años y queda solo el título. */
export const ARC_YEARS_MIN_WIDTH = 200;
const EDGE = 8;

/**
 * Franja de capítulos encima de la regla de años: un corchete fino por arco con su título y sus
 * años, alineados con la escena. El capítulo en el que está la cámara se ilumina. Decorativa
 * (aria-hidden): los capítulos accesibles están en el índice.
 */
export class ArcStrip implements TimelineViewPart, ProjectionListener {
  private readonly segments = new Map<string, Segment>();

  constructor(private readonly root: HTMLElement) {
    root.setAttribute('aria-hidden', 'true');
    root.hidden = true;
  }

  render(model: TimelineViewModel): void {
    clear(this.root);
    this.segments.clear();
    const { arcs } = model.timeline;
    this.root.hidden = arcs.length === 0;
    for (const arc of arcs) {
      const caption = el('span', { class: 'arc-strip__caption' }, [
        el('span', { class: 'arc-strip__title', text: arc.title }),
        el('span', { class: 'arc-strip__years', text: arcYears(arc, STRINGS.today) }),
      ]);
      const element = el('div', { class: 'arc-strip__segment' }, [caption]);
      element.dataset.arc = arc.id;
      this.segments.set(arc.id, { element, caption });
      this.root.append(element);
    }
  }

  onProjected(frame: ProjectedFrame): void {
    const width = frame.viewport.width;
    // Un capítulo sin nodos visibles (filtrado) no está en el layout: se oculta.
    const present = new Set((frame.arcs ?? []).map((arc) => arc.id));
    for (const [id, segment] of this.segments) if (!present.has(id)) segment.element.hidden = true;
    for (const arc of frame.arcs ?? []) {
      const segment = this.segments.get(arc.id);
      if (!segment) continue;
      const left = Math.max(EDGE, Math.min(arc.startX, arc.endX));
      const right = Math.min(width - EDGE, Math.max(arc.startX, arc.endX));
      const visible = right - left > 2;
      segment.element.hidden = !visible;
      if (!visible) continue;
      segment.element.style.transform = `translate3d(${left.toFixed(1)}px, 0, 0)`;
      segment.element.style.width = `${(right - left).toFixed(1)}px`;
      segment.element.classList.toggle('arc-strip__segment--active', arc.active);
      // El título se queda en la parte visible del capítulo; si no cabe, solo queda el corchete.
      segment.caption.hidden = right - left < ARC_CAPTION_MIN_WIDTH;
      segment.element.classList.toggle('arc-strip__segment--narrow', right - left < ARC_YEARS_MIN_WIDTH);
    }
  }
}
