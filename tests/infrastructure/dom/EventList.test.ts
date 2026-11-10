import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventList } from '../../../src/infrastructure/dom/EventList';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { cleanupDom, click, mount, press, texts } from '../../helpers/dom';
import { buildModel, fakeHandlers, selection } from '../../helpers/fixtures';

afterEach(cleanupDom);

function setup(options: { withToggle?: boolean; hidden?: boolean } = {}): {
  root: HTMLElement;
  toggle: HTMLButtonElement | null;
  list: EventList;
  handlers: ReturnType<typeof fakeHandlers>;
} {
  const toggle = options.withToggle === false ? null : mount('button');
  const root = mount('nav');
  root.hidden = options.hidden ?? true;
  const list = new EventList(root, toggle);
  const handlers = fakeHandlers();
  list.bind(handlers);
  list.render(buildModel());
  return { root, toggle, list, handlers };
}

const buttons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.index__button')];

describe('EventList (índice accesible)', () => {
  it('es una lista ordenada con título, etiquetada para lectores de pantalla', () => {
    const { root } = setup();
    expect(root.getAttribute('aria-label')).toBe(STRINGS.indexTitle);
    expect(root.querySelector('h2')?.textContent).toBe(STRINGS.indexTitle);
    expect(root.querySelector('ol.index__list')?.children).toHaveLength(4);
  });

  it('cada evento es un botón con fecha, título, categoría principal y resumen, en orden cronológico', () => {
    const { root } = setup();
    expect(texts(root, '.index__name')).toEqual(['Escuela', 'Primer trabajo', 'Proyecto paralelo', 'Segunda parte']);
    expect(texts(root, '.index__category')).toEqual(['Estudios', 'Trabajo', 'Juego', 'Juego']);
    expect(texts(root, '.index__summary')[0]).toBe('Cuatro años de estudio.');
    expect(texts(root, '.index__date')[0]).toBe('2010 — 2014');
    expect(texts(root, '.index__date')[1]).toMatch(/— actualidad$/);
    expect(buttons(root).map((button) => button.style.getPropertyValue('--accent'))).toEqual(['#6EA8FF', '#FFB454', '#B48CFF', '#B48CFF']);
    for (const button of buttons(root)) expect(button.type).toBe('button');
  });

  it('pulsar un evento lo abre', () => {
    const { root, handlers } = setup();
    click(buttons(root)[2]);
    expect(handlers.onEventActivated).toHaveBeenCalledExactlyOnceWith('c-side');
  });

  it('los eventos filtrados se atenúan y se desactivan (no desaparecen)', () => {
    const { root, list } = setup();
    list.applyFilter({ activeCategoryIds: new Set(['study']), visibleEventIds: new Set(['a-school', 'b-job']), totalEvents: 4 });
    expect(buttons(root).map((button) => button.disabled)).toEqual([false, false, true, true]);
    expect([...root.querySelectorAll('.index__item')].map((item) => item.classList.contains('index__item--filtered'))).toEqual([
      false, false, true, true,
    ]);
    list.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(['c-side']), totalEvents: 4 });
    expect(buttons(root).map((button) => button.disabled)).toEqual([true, true, false, true]);
  });

  it('marca el evento enfocado con aria-current', () => {
    const { root, list } = setup();
    list.applySelection(selection('b-job'));
    expect(buttons(root).map((button) => button.getAttribute('aria-current'))).toEqual([null, 'true', null, null]);
    list.applySelection(selection('c-side', true));
    expect(buttons(root).map((button) => button.getAttribute('aria-current'))).toEqual([null, null, 'true', null]);
    list.applySelection(selection(null));
    expect(root.querySelector('[aria-current]')).toBeNull();
  });

  it('volver a pintar no duplica elementos', () => {
    const { root, list } = setup();
    list.render(buildModel());
    expect(buttons(root)).toHaveLength(4);
    expect(root.querySelectorAll('h2')).toHaveLength(1);
  });

  it('sin handlers enlazados, pulsar no falla', () => {
    const root = mount('nav');
    const list = new EventList(root);
    list.render(buildModel());
    expect(() => click(buttons(root)[0])).not.toThrow();
  });
});

describe('EventList: abrir y cerrar', () => {
  it('el botón conmuta el panel, refleja aria-expanded y lleva el foco al primer evento disponible', () => {
    const { root, toggle, list } = setup();
    if (!toggle) throw new Error('falta el botón');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    list.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(['b-job', 'c-side']), totalEvents: 4 });

    click(toggle);
    expect(root.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(buttons(root)[1]);

    click(toggle);
    expect(root.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('aria-expanded inicial refleja un panel que ya está abierto', () => {
    const { toggle } = setup({ hidden: false });
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('Esc dentro del índice lo cierra, devuelve el foco al botón y no deja pasar la tecla', () => {
    const { root, toggle, list } = setup();
    if (!toggle) throw new Error('falta el botón');
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    list.setOpen(true);

    press(buttons(root)[0], 'Escape');

    expect(root.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
  });

  it('otras teclas, o Esc con el panel cerrado, siguen su camino', () => {
    const { root, list } = setup();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    press(root, 'Escape');
    list.setOpen(true);
    press(buttons(root)[0], 'ArrowRight');
    expect(outer).toHaveBeenCalledTimes(2);
    expect(root.hidden).toBe(false);
    window.removeEventListener('keydown', outer);
  });

  it('sin botón de conmutación, Esc no cierra el índice', () => {
    const { root } = setup({ withToggle: false, hidden: false });
    press(buttons(root)[0], 'Escape');
    expect(root.hidden).toBe(false);
  });

  it('modo sin WebGL: pasa a contenido principal, con aviso, y no se puede cerrar', () => {
    const { root, toggle, list } = setup();
    list.showAsMainContent(STRINGS.noWebgl);
    expect(root.hidden).toBe(false);
    expect(root.classList.contains('index--main')).toBe(true);
    expect(toggle?.hidden).toBe(true);
    const notice = root.firstElementChild;
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toBe(STRINGS.noWebgl);
    expect(buttons(root)).toHaveLength(4);
  });

  it('modo sin WebGL también funciona sin botón de conmutación', () => {
    const { root, list } = setup({ withToggle: false });
    expect(() => list.showAsMainContent('aviso')).not.toThrow();
    expect(root.hidden).toBe(false);
  });
});
