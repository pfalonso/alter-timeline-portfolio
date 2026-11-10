import type { CameraControls } from '../three/types';
import { el } from './dom';
import { STRINGS } from './strings';

/** Botones de cámara (acercar, alejar, vista general) y atajos +/−/0. */
export class ViewControls {
  constructor(root: HTMLElement, controls: CameraControls, keyTarget: Pick<Window, 'addEventListener'> = window) {
    const button = (label: string, glyph: string, action: () => void): HTMLButtonElement => {
      const node = el('button', { class: 'controls__button', text: glyph, attrs: { type: 'button', 'aria-label': label, title: label } });
      node.addEventListener('click', action);
      return node;
    };
    root.append(
      button(STRINGS.zoomIn, '+', () => controls.zoomBy(0.75)),
      button(STRINGS.zoomOut, '−', () => controls.zoomBy(1 / 0.75)),
      button(STRINGS.overview, '◇', () => controls.showOverview()),
    );
    keyTarget.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select')) return;
      if (key === '+' || key === '=') controls.zoomBy(0.8);
      else if (key === '-' || key === '_') controls.zoomBy(1.25);
      else if (key === '0') controls.showOverview();
    });
  }
}
