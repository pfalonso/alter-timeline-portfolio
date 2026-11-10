import type { Timeline } from '../../domain/model';

export interface SelectionState {
  readonly focusedEventId: string | null;
  readonly detailOpen: boolean;
}

export const NO_SELECTION: SelectionState = { focusedEventId: null, detailOpen: false };

/** Reglas de selección: solo se puede enfocar/abrir un evento existente y visible. */
export class SelectEvent {
  execute(
    timeline: Timeline,
    visibleEventIds: ReadonlySet<string>,
    current: SelectionState,
    eventId: string | null,
    openDetail: boolean,
  ): SelectionState {
    if (eventId === null) return NO_SELECTION;
    if (!timeline.getEvent(eventId) || !visibleEventIds.has(eventId)) return current;
    return { focusedEventId: eventId, detailOpen: openDetail };
  }

  /** Tras cambiar el filtro: si el evento enfocado ya no es visible, se suelta. */
  reconcile(visibleEventIds: ReadonlySet<string>, current: SelectionState): SelectionState {
    return current.focusedEventId !== null && !visibleEventIds.has(current.focusedEventId) ? NO_SELECTION : current;
  }
}
