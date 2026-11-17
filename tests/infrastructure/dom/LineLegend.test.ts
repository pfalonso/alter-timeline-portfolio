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
  const frameAt = (lookX?: number, nowX: number | null = null) => ({ nodes: [], years: [], nowX, cameraDistance: 30, viewport: { width: 800, height: 600 }, lookX });

  function settled(m = model) {
    let now = 0;
    const root = mount('div', { id: 'lines' });
    const keys = mount('div');
    const highlight = vi.fn<(id: string | null) => void>();
    const legend = new LineLegend(root, { highlightBranch: highlight }, { fallbackColor: '#a9d4ff', keysRoot: keys, clock: () => now, settleMs: 300 });
    const handlers = fakeHandlers();
    legend.bind(handlers);
    legend.render(m);
    const project = (lookX?: number, nowX: number | null = null): void => {
      legend.onProjected(frameAt(lookX, nowX));
      now += 400;
      legend.onProjected(frameAt(lookX, nowX));
    };
    return { root, keys, legend, highlight, handlers, project, tick: (ms: number) => (now += ms) };
  }

  it('lista las líneas en una rejilla fija con su color y nombre; «cerrada» solo si termina de verdad', () => {
    const { root } = setup();
    expect(root.hidden).toBe(false);
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe(STRINGS.linesLabel);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.line')];
    expect(buttons.map((button) => button.dataset.branch)).toEqual(['core', 'art', 'food', 'teach']);
    expect(buttons.map((button) => button.querySelector('.line__label')?.textContent)).toEqual(['Oficio', 'Arte', 'Cocina', 'Enseñar']);
    expect(buttons[0].classList.contains('line--main')).toBe(true);
    expect(buttons.map((button) => button.querySelector('.line__status')?.textContent ?? null)).toEqual([
      null,
      STRINGS.mergesInto('Oficio'),
      null,
      STRINGS.closedLine,
    ]);
    expect(buttons[3].classList.contains('line--closed')).toBe(true);
    // Ningún marcador de forma sin explicación (U-33).
    expect(root.querySelector('.line__mark')).toBeNull();
    // Sin color declarado, el de su primer evento (como en la escena).
    expect(buttons[0].style.getPropertyValue('--line-color')).toBe('#FFB454');
    expect(buttons[2].style.getPropertyValue('--line-color')).toBe('#7BE0A4');
  });

  it('«en foco» sale de los periodos focus (no de la geometría) y lleva el momento: «hoy» o el año', () => {
    const { root, legend, project } = settled();
    const spans = model.layout.focusSpans;
    const last = spans[spans.length - 1];
    // Con «hoy» en pantalla: la composición de hoy, rotulada «hoy».
    project(spans[0].startX, 400);
    expect(legend.braidedLines).toEqual(last.members);
    expect(root.querySelector('.lines__now')?.textContent).toBe(`${STRINGS.focusWhen(STRINGS.today)}: Oficio`);
    for (const branch of model.layout.branches) {
      expect(item(root, branch.id).classList.contains('line--braided')).toBe(last.members.includes(branch.id));
    }
    // Sin «hoy» en pantalla: la composición de donde mira la cámara y el año del momento más cercano.
    const food = spans.find((span) => span.members.includes('food')) as (typeof spans)[number];
    project((food.startX + food.endX) / 2);
    expect(legend.braidedLines).toEqual(food.members);
    expect(root.querySelector('.lines__now')?.textContent).toMatch(/^En foco · 20\d\d: /);
    expect(item(root, 'food').querySelector<HTMLElement>('.line__focus')?.hidden).toBe(false);
    // Fuera de los extremos, el tramo más cercano; sin lookX no cambia nada.
    project(spans[0].startX - 100);
    expect(legend.braidedLines).toEqual(spans[0].members);
    project(undefined);
    expect(legend.braidedLines).toEqual(spans[0].members);
  });

  it('no cambia de estado mientras la cámara se mueve: solo cuando lleva un rato quieta', () => {
    const { legend, tick } = settled();
    const spans = model.layout.focusSpans;
    legend.onProjected(frameAt(spans[0].startX));
    expect(legend.braidedLines).toEqual([]);
    tick(100);
    legend.onProjected(frameAt(spans[0].startX));
    expect(legend.braidedLines).toEqual([]);
    tick(300);
    legend.onProjected(frameAt(spans[0].startX));
    expect(legend.braidedLines).toEqual(spans[0].members);
  });

  it('no aparece con datos sin branches (modelo antiguo)', () => {
    const { root, highlight } = setup(buildModel());
    expect(root.hidden).toBe(true);
    expect(root.childElementCount).toBe(0);
    expect(highlight).not.toHaveBeenCalled();
  });

  it('hover y foco de teclado resaltan la línea y muestran su descripción y sus periodos en foco', () => {
    const { root, legend, highlight } = setup();
    item(root, 'food').dispatchEvent(new Event('pointerenter'));
    expect(highlight).toHaveBeenLastCalledWith('food');
    expect(legend.highlighted).toBe('food');
    expect(root.classList.contains('lines--highlighting')).toBe(true);
    expect(item(root, 'food').classList.contains('line--active')).toBe(true);
    const desc = root.querySelector<HTMLElement>('.lines__desc') as HTMLElement;
    expect(desc.hidden).toBe(false);
    expect(desc.textContent).toContain('Cocina');
    expect(desc.textContent).toContain(STRINGS.focusPeriods('2011 – 2012'));
    item(root, 'food').dispatchEvent(new Event('pointerleave'));
    expect(highlight).toHaveBeenLastCalledWith(null);
    expect(desc.hidden).toBe(true);
    item(root, 'art').focus();
    expect(highlight).toHaveBeenLastCalledWith('art');
    item(root, 'art').blur();
    expect(highlight).toHaveBeenLastCalledWith(null);
  });

  it('pulsar una línea la aísla (filtro de primer nivel); el estado llega por applyFilter', () => {
    const { root, legend, handlers } = settled();
    item(root, 'teach').click();
    expect(handlers.onLineIsolated).toHaveBeenLastCalledWith('teach');
    legend.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 0, isolatedLine: 'teach' });
    expect(item(root, 'teach').getAttribute('aria-pressed')).toBe('true');
    expect(item(root, 'teach').title).toBe(STRINGS.lineIsolated);
    expect(root.classList.contains('lines--isolating')).toBe(true);
    item(root, 'teach').click();
    expect(handlers.onLineIsolated).toHaveBeenLastCalledWith(null);
    legend.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 0, layout: model.layout });
    expect(item(root, 'teach').getAttribute('aria-pressed')).toBe('false');
  });

  it('claves de lectura en su propio contenedor (foco, encrucijada…), según lo que haya en los datos', () => {
    const { keys } = settled();
    expect([...keys.querySelectorAll('.key')].map((key) => key.className)).toEqual(['key key--focus']);
    expect(keys.querySelector('.keys__title')?.textContent).toBe(STRINGS.keysTitle);
  });

  it('funciona sin escena (sin resaltador) y sin manejadores', () => {
    const root = mount('div');
    const legend = new LineLegend(root, null, { fallbackColor: '#fff' });
    legend.render(model);
    expect(() => root.querySelector<HTMLButtonElement>('.line')?.click()).not.toThrow();
    expect(root.querySelector('#lines-list, .lines__list')).not.toBeNull();
    expect(root.querySelector('.keys')).not.toBeNull();
  });
});

describe('Pop-up e índice muestran la línea del evento', () => {
  it('el pop-up lleva una insignia con el nombre de la línea', () => {
    const popup = new EventPopup(mount('aside'));
    popup.bind(fakeHandlers());
    popup.render(model);
    popup.applySelection(selection('bread', true));
    expect(document.querySelector('.popup__meta .badge--line')?.textContent).toBe(STRINGS.lineOf('Cocina'));
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
