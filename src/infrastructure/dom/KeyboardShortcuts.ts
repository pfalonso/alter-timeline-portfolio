import type { SelectionViewState, TimelineViewHandlers } from '../../application/ports';
import type { TimelineViewPart } from './CompositeTimelineView';

export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
}

const INTERACTIVE = 'button, a, input, select, textarea, [contenteditable]';

/**
 * Atajos globales: ←/→ saltan al siguiente evento de importancia ≥ 2 (Mayús+←/→ nodo a nodo; en
 * modo historia, siguen el recorrido), Enter abre el enfocado, H entra o sale de la historia y
 * Esc sale de la historia, cierra el pop-up o suelta el foco.
 */
export class KeyboardShortcuts implements TimelineViewPart {
  private handlers: TimelineViewHandlers | null = null;
  private selection: SelectionViewState | null = null;

  constructor(target: KeyTarget) {
    target.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  applySelection(state: SelectionViewState): void {
    this.selection = state;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.handlers || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const onControl = event.target instanceof Element && event.target.closest(INTERACTIVE) !== null;
    const granularity = event.shiftKey ? 'all' : 'major';
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.handlers.onNavigate('next', granularity);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.handlers.onNavigate('previous', granularity);
        break;
      case 'h':
      case 'H':
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
        if (this.selection?.story) this.handlers.onStoryExit();
        else this.handlers.onStoryStart();
        break;
      case 'Enter':
      case ' ':
        // En un botón/enlace, Enter y Espacio hacen lo suyo.
        if (onControl || !this.selection?.focusedEventId || this.selection.detailOpen) return;
        event.preventDefault();
        this.handlers.onEventActivated(this.selection.focusedEventId);
        break;
      case 'Escape':
        if (this.selection?.story) this.handlers.onStoryExit();
        else if (this.selection?.detailOpen) this.handlers.onDetailClosed();
        else if (this.selection?.focusedEventId) this.handlers.onSelectionCleared();
        break;
    }
  }
}
