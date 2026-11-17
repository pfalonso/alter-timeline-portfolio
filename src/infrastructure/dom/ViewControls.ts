import type { CameraControls } from '../three/types';
import { el } from './dom';
import { icon, type IconName } from './icons';
import { STRINGS } from './strings';

/**
 * Botones de cámara con icono reconocible y rótulo al pasar el ratón o al recibir foco (acercar,
 * alejar, ver toda la línea) y atajos +/−/0. Con `help`, un botón «?» despliega los atajos de
 * teclado (la pantalla no lleva el párrafo de atajos a la vista).
 */
export class ViewControls {
  constructor(
    root: HTMLElement,
    controls: CameraControls,
    keyTarget: Pick<Window, 'addEventListener'> = window,
    help?: HTMLElement | null,
  ) {
    const button = (label: string, glyph: IconName, action: () => void): HTMLButtonElement => {
      const node = el('button', { class: 'controls__button', attrs: { type: 'button', 'aria-label': label, title: label, 'data-tip': label } }, [icon(glyph)]);
      node.addEventListener('click', action);
      return node;
    };
    root.append(
      button(STRINGS.zoomIn, 'plus', () => controls.zoomBy(0.75)),
      button(STRINGS.zoomOut, 'minus', () => controls.zoomBy(1 / 0.75)),
      button(STRINGS.overview, 'expand', () => controls.showOverview()),
    );
    if (help) this.mountHelp(root, help);
    keyTarget.addEventListener('keydown', (event) => {
      const { key, ctrlKey, metaKey, altKey } = event as KeyboardEvent;
      // Ctrl/⌘ con +, − y 0 son el zoom del navegador: no se tocan.
      if (ctrlKey || metaKey || altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select')) return;
      if (key === '+' || key === '=') controls.zoomBy(0.8);
      else if (key === '-' || key === '_') controls.zoomBy(1.25);
      else if (key === '0') controls.showOverview();
    });
  }

  /** Botón «?» y panel con los atajos (lista de definiciones). */
  private mountHelp(root: HTMLElement, panel: HTMLElement): void {
    const toggle = el('button', {
      class: 'controls__button controls__button--help',
      attrs: { type: 'button', 'aria-label': STRINGS.help, title: STRINGS.help, 'data-tip': STRINGS.help, 'aria-expanded': 'false' },
    }, [icon('help')]);
    if (panel.id) toggle.setAttribute('aria-controls', panel.id);
    panel.hidden = true;
    panel.replaceChildren(
      el('p', { class: 'shortcuts__title', text: STRINGS.helpTitle }),
      el('dl', { class: 'shortcuts__list' }, STRINGS.helpItems.flatMap(([keys, what]) => [el('dt', { text: keys }), el('dd', { text: what })])),
    );
    const setOpen = (open: boolean): void => {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(panel.hidden === true));
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        toggle.focus();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!panel.hidden && event.target instanceof Node && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
    });
    root.append(toggle);
  }
}
