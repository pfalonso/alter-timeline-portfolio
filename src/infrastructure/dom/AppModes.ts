import type { SelectionViewState } from '../../application/ports';
import type { TimelineViewPart } from './CompositeTimelineView';

/**
 * Clases de estado en el contenedor de la app que reorganizan la interfaz: con una ficha abierta
 * (`app--detail`) se retiran cabecera, leyenda, filtros y pista para que a la izquierda solo quede
 * escena. (La historia añade las suyas desde `StoryControls`.)
 */
export class AppModes implements TimelineViewPart {
  constructor(private readonly app: HTMLElement) {}

  applySelection(state: SelectionViewState): void {
    this.app.classList.toggle('app--detail', state.detailOpen);
  }
}

/**
 * Pista de una sola acción («Arrastra para viajar · pulsa un momento») que desaparece tras la
 * primera interacción con la escena (arrastrar, rueda, tocar o las flechas).
 */
export class InteractionHint {
  private gone = false;

  constructor(
    private readonly hint: HTMLElement,
    text: string,
    stage: Pick<HTMLElement, 'addEventListener'>,
    keys: Pick<Window, 'addEventListener'> = window,
  ) {
    hint.textContent = text;
    const dismiss = (): void => this.dismiss();
    for (const type of ['pointerdown', 'wheel', 'touchstart'] as const) stage.addEventListener(type, dismiss, { passive: true });
    keys.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'ArrowLeft' || key === 'ArrowRight') dismiss();
    });
  }

  get dismissed(): boolean {
    return this.gone;
  }

  dismiss(): void {
    if (this.gone) return;
    this.gone = true;
    this.hint.classList.add('help--gone');
    this.hint.hidden = true;
  }
}
