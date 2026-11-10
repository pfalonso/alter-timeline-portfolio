import { afterEach, describe, expect, it } from 'vitest';
import { KeyboardShortcuts } from '../../../src/infrastructure/dom/KeyboardShortcuts';
import { cleanupDom, mount, press } from '../../helpers/dom';
import { fakeHandlers, selection, type FakeHandlers } from '../../helpers/fixtures';

afterEach(cleanupDom);

/** Cada test usa su propio contenedor como destino para no acumular listeners en window. */
function setup(bind = true): { target: HTMLElement; shortcuts: KeyboardShortcuts; handlers: FakeHandlers } {
  const target = mount('div');
  const shortcuts = new KeyboardShortcuts(target);
  const handlers = fakeHandlers();
  if (bind) shortcuts.bind(handlers);
  return { target, shortcuts, handlers };
}

function totalCalls(handlers: FakeHandlers): number {
  return Object.values(handlers).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

describe('KeyboardShortcuts', () => {
  it('→ y ← saltan al evento siguiente/anterior y anulan el desplazamiento del navegador', () => {
    const { target, handlers } = setup();
    const right = press(target, 'ArrowRight');
    const left = press(target, 'ArrowLeft');
    expect(handlers.onNavigate.mock.calls).toEqual([['next'], ['previous']]);
    expect(right.defaultPrevented).toBe(true);
    expect(left.defaultPrevented).toBe(true);
  });

  it('las flechas funcionan también con el foco en un botón (p. ej. dentro del pop-up)', () => {
    const { target, handlers } = setup();
    const button = document.createElement('button');
    target.append(button);
    press(button, 'ArrowRight');
    expect(handlers.onNavigate).toHaveBeenCalledExactlyOnceWith('next');
  });

  it.each([['Enter'], [' ']])('%j abre el evento enfocado si el detalle está cerrado', (key) => {
    const { target, shortcuts, handlers } = setup();
    shortcuts.applySelection(selection('b-job', false));
    const event = press(target, key);
    expect(handlers.onEventActivated).toHaveBeenCalledExactlyOnceWith('b-job');
    expect(event.defaultPrevented).toBe(true);
  });

  it('Enter no hace nada sin evento enfocado, con el detalle ya abierto o antes de conocer la selección', () => {
    const { target, shortcuts, handlers } = setup();
    expect(press(target, 'Enter').defaultPrevented).toBe(false);
    shortcuts.applySelection(selection(null));
    press(target, 'Enter');
    shortcuts.applySelection(selection('b-job', true));
    press(target, 'Enter');
    expect(totalCalls(handlers)).toBe(0);
  });

  it.each([['button'], ['a'], ['input'], ['select'], ['textarea']])(
    'Enter y Espacio sobre un <%s> hacen lo suyo: no abren el evento',
    (tag) => {
      const { target, shortcuts, handlers } = setup();
      shortcuts.applySelection(selection('b-job', false));
      const control = document.createElement(tag);
      const inner = document.createElement('span');
      control.append(inner);
      target.append(control);
      expect(press(control, 'Enter').defaultPrevented).toBe(false);
      expect(press(inner, ' ').defaultPrevented).toBe(false);
      expect(handlers.onEventActivated).not.toHaveBeenCalled();
    },
  );

  it('Esc cierra el detalle si está abierto', () => {
    const { target, shortcuts, handlers } = setup();
    shortcuts.applySelection(selection('b-job', true));
    press(target, 'Escape');
    expect(handlers.onDetailClosed).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectionCleared).not.toHaveBeenCalled();
  });

  it('Esc sin detalle abierto suelta el foco del evento; sin nada enfocado no hace nada', () => {
    const { target, shortcuts, handlers } = setup();
    press(target, 'Escape');
    shortcuts.applySelection(selection(null));
    press(target, 'Escape');
    expect(totalCalls(handlers)).toBe(0);
    shortcuts.applySelection(selection('b-job', false));
    press(target, 'Escape');
    expect(handlers.onSelectionCleared).toHaveBeenCalledTimes(1);
    expect(handlers.onDetailClosed).not.toHaveBeenCalled();
  });

  it.each([[{ ctrlKey: true }], [{ metaKey: true }], [{ altKey: true }]])(
    'no interfiere con los atajos del navegador (%j)',
    (modifier) => {
      const { target, shortcuts, handlers } = setup();
      shortcuts.applySelection(selection('b-job', true));
      for (const key of ['ArrowRight', 'ArrowLeft', 'Enter', 'Escape']) {
        expect(press(target, key, modifier).defaultPrevented).toBe(false);
      }
      expect(totalCalls(handlers)).toBe(0);
    },
  );

  it('respeta los eventos que ya ha gestionado otro (defaultPrevented)', () => {
    const { target, handlers } = setup();
    const inner = document.createElement('div');
    target.append(inner);
    inner.addEventListener('keydown', (event) => event.preventDefault());
    press(inner, 'ArrowRight');
    expect(handlers.onNavigate).not.toHaveBeenCalled();
  });

  it('ignora el resto de teclas', () => {
    const { target, shortcuts, handlers } = setup();
    shortcuts.applySelection(selection('b-job', false));
    for (const key of ['a', 'Tab', 'ArrowUp', 'ArrowDown', 'Home']) expect(press(target, key).defaultPrevented).toBe(false);
    expect(totalCalls(handlers)).toBe(0);
  });

  it('antes de enlazar handlers no hace nada (ni anula teclas)', () => {
    const { target } = setup(false);
    expect(press(target, 'ArrowRight').defaultPrevented).toBe(false);
  });

  it('funciona con window como destino (uso real)', () => {
    const shortcuts = new KeyboardShortcuts(window);
    const handlers = fakeHandlers();
    shortcuts.bind(handlers);
    press(document.body, 'ArrowRight');
    expect(handlers.onNavigate).toHaveBeenCalledExactlyOnceWith('next');
    // Si el evento nace en window, el destino no es un Element: no debe fallar.
    shortcuts.applySelection(selection('b-job', false));
    press(window, 'Enter');
    expect(handlers.onEventActivated).toHaveBeenCalledExactlyOnceWith('b-job');
  });
});
