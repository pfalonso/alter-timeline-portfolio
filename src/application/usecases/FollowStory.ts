import type { Timeline } from '../../domain/model';
import type { NavigationDirection } from '../ports';

/** Un paso resuelto del recorrido. */
export interface StoryStep {
  readonly index: number;
  readonly eventId: string;
}

/**
 * Reglas del modo historia: el recorrido es `story.path` limitado a los eventos visibles (el
 * filtro de categorías también lo acorta), en su orden. Sin estado: el controlador guarda el paso.
 */
export class FollowStory {
  path(timeline: Timeline, visibleEventIds: ReadonlySet<string>): string[] {
    return timeline.storyPath.filter((id) => visibleEventIds.has(id));
  }

  /** Paso desde el que empieza el recorrido: el evento indicado si está en él; si no, el primero. */
  start(path: readonly string[], fromEventId?: string): StoryStep | null {
    if (path.length === 0) return null;
    const index = fromEventId === undefined ? 0 : Math.max(0, path.indexOf(fromEventId));
    return { index, eventId: path[index] };
  }

  /** Paso vecino de `eventId` en el sentido indicado; `null` si no está en el recorrido o es un extremo. */
  step(path: readonly string[], eventId: string | null, direction: NavigationDirection): StoryStep | null {
    const index = eventId === null ? -1 : path.indexOf(eventId);
    if (index === -1) return null;
    const target = index + (direction === 'next' ? 1 : -1);
    return target < 0 || target >= path.length ? null : { index: target, eventId: path[target] };
  }

  /** `true` si `toId` está en un arco distinto del de `fromId` (o se entra en el recorrido). */
  isNewChapter(timeline: Timeline, fromId: string | null, toId: string): boolean {
    const to = timeline.getEvent(toId);
    const arc = to ? timeline.arcOf(to) : undefined;
    if (!arc) return false;
    const from = fromId === null ? undefined : timeline.getEvent(fromId);
    return !from || timeline.arcOf(from)?.id !== arc.id;
  }
}
