import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { ViewControls } from '../../../src/infrastructure/dom/ViewControls';
import { cleanupDom, click, mount, press } from '../../helpers/dom';

afterEach(cleanupDom);

function setup(): { root: HTMLElement; keys: HTMLElement; controls: { zoomBy: ReturnType<typeof vi.fn>; showOverview: ReturnType<typeof vi.fn> } } {
  const root = mount('div');
  const keys = mount('div');
  const controls = { zoomBy: vi.fn(), showOverview: vi.fn() };
  new ViewControls(root, controls, keys);
  return { root, keys, controls };
}

describe('ViewControls', () => {
  it('pinta tres botones con nombre accesible', () => {
    const { root } = setup();
    const buttons = [...root.querySelectorAll('button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([STRINGS.zoomIn, STRINGS.zoomOut, STRINGS.overview]);
    expect(buttons.map((button) => button.title)).toEqual([STRINGS.zoomIn, STRINGS.zoomOut, STRINGS.overview]);
    for (const button of buttons) expect(button.type).toBe('button');
  });

  it('acercar reduce la distancia, alejar la aumenta en la misma proporción, y ◇ muestra la vista general', () => {
    const { root, controls } = setup();
    const [zoomIn, zoomOut, overview] = [...root.querySelectorAll('button')];
    click(zoomIn);
    click(zoomOut);
    click(overview);
    const [inFactor, outFactor] = controls.zoomBy.mock.calls.map((call) => call[0] as number);
    expect(inFactor).toBeLessThan(1);
    expect(outFactor).toBeGreaterThan(1);
    expect(inFactor * outFactor).toBeCloseTo(1, 10);
    expect(controls.showOverview).toHaveBeenCalledTimes(1);
  });

  it('atajos: + / = acercan, − / _ alejan, 0 vista general', () => {
    const { keys, controls } = setup();
    press(keys, '+');
    press(keys, '=');
    press(keys, '-');
    press(keys, '_');
    press(keys, '0');
    expect(controls.zoomBy.mock.calls.map((call) => (call[0] as number) < 1)).toEqual([true, true, false, false]);
    expect(controls.showOverview).toHaveBeenCalledTimes(1);
  });

  it('ignora otras teclas y lo que se escribe en campos de texto', () => {
    const { keys, controls } = setup();
    press(keys, 'a');
    press(keys, '1');
    for (const tag of ['input', 'textarea', 'select'] as const) {
      const field = document.createElement(tag);
      keys.append(field);
      press(field, '+');
      press(field, '0');
    }
    expect(controls.zoomBy).not.toHaveBeenCalled();
    expect(controls.showOverview).not.toHaveBeenCalled();
  });

  it('por defecto escucha en window', () => {
    const controls = { zoomBy: vi.fn(), showOverview: vi.fn() };
    new ViewControls(mount('div'), controls);
    press(document.body, '0');
    press(window, '+');
    expect(controls.showOverview).toHaveBeenCalledTimes(1);
    expect(controls.zoomBy).toHaveBeenCalledTimes(1);
  });
});
