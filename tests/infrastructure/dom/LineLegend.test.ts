import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventList } from '../../../src/infrastructure/dom/EventList';
import { EventPopup } from '../../../src/infrastructure/dom/EventPopup';
import { LineLegend } from '../../../src/infrastructure/dom/LineLegend';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { cleanupDom, mount } from '../../helpers/dom';
import { buildModel, fakeHandlers, makeLifeLinesData, selection } from '../../helpers/fixtures';

afterEach(cleanupDom);

const model = buildModel(makeLifeLinesData());

function setup(m = model): { root: HTMLElement; legend: LineLegend; highlight: ReturnType<typeof vi.fn> } {
  const root = mount('div', { id: 'lines' });
  const highlight = vi.fn<(id: string | null) => void>();
  const legend = new LineLegend(root, { highlightBranch: highlight }, { fallbackColor: '#a9d4ff' });
  legend.render(m);
  return { root, legend, highlight };
}
const item = (root: HTMLElement, id: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`[data-branch="${id}"]`) as HTMLButtonElement;

describe('LineLegend', () => {
  it('lista las líneas con su color y nombre; la central primero y marcada como foco actual', () => {
    const { root } = setup();
    expect(root.hidden).toBe(false);
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe(STRINGS.linesLabel);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.line')];
    expect(buttons.map((button) => button.dataset.branch)).toEqual(['core', 'art', 'food', 'teach']);
    expect(buttons.map((button) => button.querySelector('.line__label')?.textContent)).toEqual(['Oficio', 'Arte', 'Cocina', 'Enseñar']);
    expect(buttons[0].classList.contains('line--main')).toBe(true);
    expect(buttons.map((button) => button.querySelector('.line__status')?.textContent ?? null)).toEqual([
      STRINGS.currentFocus,
      STRINGS.mergesInto('Oficio'),
      STRINGS.latent,
      STRINGS.closedLine,
    ]);
    expect(buttons[0].style.getPropertyValue('--line-color')).toBe('#a9d4ff');
    expect(buttons[2].style.getPropertyValue('--line-color')).toBe('#7BE0A4');
  });

  it('cada línea muestra su lenguaje de forma (style o el de por defecto)', () => {
    const { root } = setup();
    for (const branch of model.layout.branches) {
      const mark = item(root, branch.id).querySelector('.line__mark');
      expect(mark?.classList.contains(`line__mark--${model.timeline.lineStyleOf(branch.id)}`)).toBe(true);
    }
  });

  it('no aparece con datos sin branches (modelo antiguo)', () => {
    const { root, highlight } = setup(buildModel());
    expect(root.hidden).toBe(true);
    expect(root.childElementCount).toBe(0);
    expect(highlight).not.toHaveBeenCalled();
  });

  it('hover y foco de teclado resaltan la línea en la escena; al salir se suelta', () => {
    const { root, legend, highlight } = setup();
    item(root, 'food').dispatchEvent(new Event('pointerenter'));
    expect(highlight).toHaveBeenLastCalledWith('food');
    expect(legend.highlighted).toBe('food');
    expect(root.classList.contains('lines--highlighting')).toBe(true);
    expect(item(root, 'food').classList.contains('line--active')).toBe(true);
    item(root, 'food').dispatchEvent(new Event('pointerleave'));
    expect(highlight).toHaveBeenLastCalledWith(null);
    item(root, 'art').focus();
    expect(highlight).toHaveBeenLastCalledWith('art');
    item(root, 'art').blur();
    expect(highlight).toHaveBeenLastCalledWith(null);
  });

  it('un clic fija la línea (aria-pressed) hasta un segundo clic', () => {
    const { root, highlight } = setup();
    item(root, 'teach').click();
    expect(item(root, 'teach').getAttribute('aria-pressed')).toBe('true');
    expect(highlight).toHaveBeenLastCalledWith('teach');
    item(root, 'food').dispatchEvent(new Event('pointerenter'));
    item(root, 'food').dispatchEvent(new Event('pointerleave'));
    expect(highlight).toHaveBeenLastCalledWith('teach');
    item(root, 'teach').click();
    expect(item(root, 'teach').getAttribute('aria-pressed')).toBe('false');
    expect(highlight).toHaveBeenLastCalledWith(null);
  });

  it('se pliega y despliega con su botón (en móvil)', () => {
    const { root } = setup();
    const toggle = root.querySelector<HTMLButtonElement>('.lines__toggle') as HTMLButtonElement;
    expect(toggle.textContent).toBe(STRINGS.linesToggle(4));
    expect(toggle.getAttribute('aria-controls')).toBe('lines-list');
    expect(root.querySelector('#lines-list')).not.toBeNull();
    expect(root.classList.contains('lines--collapsed')).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.classList.contains('lines--collapsed')).toBe(false);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('funciona sin escena (sin resaltador)', () => {
    const root = mount('div');
    const legend = new LineLegend(root, null, { fallbackColor: '#fff' });
    legend.render(model);
    expect(() => root.querySelector<HTMLButtonElement>('.line')?.click()).not.toThrow();
    expect(root.querySelector('#lines-list')).not.toBeNull();
  });
});

describe('Pop-up e índice muestran la línea del evento', () => {
  it('el pop-up lleva una insignia con el nombre de la línea', () => {
    const popup = new EventPopup(mount('aside'));
    popup.bind(fakeHandlers());
    popup.render(model);
    popup.applySelection(selection('bread', true));
    expect(document.querySelector('.badge--line')?.textContent).toBe(STRINGS.lineOf('Cocina'));
  });

  it('el índice muestra la línea de cada evento', () => {
    const list = new EventList(mount('nav'), null);
    list.render(model);
    const lines = [...document.querySelectorAll('.index__line')].map((node) => node.textContent);
    expect(lines).toContain(STRINGS.lineOf('Arte'));
    expect(lines).toHaveLength(model.timeline.events.length);
  });

  it('con datos antiguos no aparece (solo «Rama que nace de…»)', () => {
    const list = new EventList(mount('nav'), null);
    list.render(buildModel());
    expect(document.querySelectorAll('.index__line')).toHaveLength(0);
  });
});
