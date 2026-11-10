import { afterEach, describe, expect, it } from 'vitest';
import { jsonFetch, mountApp, type TestApp } from '../helpers/app';
import { cleanupDom, click, press, texts } from '../helpers/dom';
import { makeData } from '../helpers/fixtures';

afterEach(() => {
  cleanupDom();
  window.history.replaceState(null, '', '/');
});

const PERSONAL = '/data/life.json';
const EXAMPLE = '/data/life.example.json';

const counter = (t: TestApp): string => t.hud.querySelector('.hud__counter')?.textContent ?? '';
const chip = (t: TestApp, id: string): HTMLButtonElement => {
  const node = t.filters.querySelector<HTMLButtonElement>(`[data-category="${id}"]`);
  if (!node) throw new Error(`no hay chip ${id}`);
  return node;
};
const title = (t: TestApp): string | null => (t.popup.hidden ? null : (t.popup.querySelector('#popup-title')?.textContent ?? null));
const indexButtons = (t: TestApp): HTMLButtonElement[] => [...t.index.querySelectorAll<HTMLButtonElement>('.index__button')];

/** Flujos de punta a punta (sin escena 3D): fetch falso → repositorio → controlador → DOM y URL. */
describe('flujo completo de la aplicación', () => {
  it('con life.json válido muestra los datos personales, sin aviso de ejemplo', async () => {
    const t = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    expect(t.started).toBe(true);
    expect(t.hud.querySelector('h1')?.textContent).toBe('Ada Test');
    expect(t.hud.querySelector('[data-testid="example-notice"]')).toBeNull();
    expect(counter(t)).toBe('4 / 4 eventos');
    expect(texts(t.index, '.index__name')).toEqual(['Escuela', 'Primer trabajo', 'Proyecto paralelo', 'Segunda parte']);
    expect(t.popup.hidden).toBe(true);
  });

  it('sin life.json (404) cae a los datos de ejemplo y lo avisa', async () => {
    const example = makeData();
    example.meta.owner = 'Persona Ficticia';
    const t = await mountApp(jsonFetch({ [EXAMPLE]: example }));
    expect(t.hud.querySelector('h1')?.textContent).toBe('Persona Ficticia');
    expect(t.hud.querySelector('[data-testid="example-notice"]')?.textContent).toBe('Datos de ejemplo');
    expect(t.warnings).toEqual([]);
  });

  it('un life.json que no valida no se muestra: ejemplo + aviso en consola con las rutas', async () => {
    const broken = makeData();
    broken.meta.owner = 'No debería verse';
    broken.events[0].links = [{ label: 'x', url: 'javascript:alert(1)' }];
    const t = await mountApp(jsonFetch({ [PERSONAL]: broken, [EXAMPLE]: makeData() }));
    expect(t.hud.querySelector('h1')?.textContent).toBe('Ada Test');
    expect(t.hud.querySelector('[data-testid="example-notice"]')).not.toBeNull();
    expect(t.warnings).toHaveLength(1);
    expect(t.warnings[0]).toContain('events[0].links[0].url');
    expect(document.body.textContent).not.toContain('No debería verse');
  });

  it('si no hay datos de ningún tipo muestra el error y no arranca', async () => {
    const t = await mountApp(jsonFetch({}));
    expect(t.started).toBe(false);
    expect(t.hud.querySelector('[role="alert"]')?.textContent).toContain('HTTP 404');
    expect(t.filters.childElementCount).toBe(0);
    expect(indexButtons(t)).toHaveLength(0);
  });

  it('los eventos privados solo aparecen con ?private=1', async () => {
    const hidden = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    expect(document.body.textContent).not.toContain('Secreto');
    expect(counter(hidden)).toBe('4 / 4 eventos');
    cleanupDom();

    window.history.replaceState(null, '', '/?private=1');
    const shown = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    expect(texts(shown.index, '.index__name')).toContain('Secreto');
    expect(counter(shown)).toBe('5 / 5 eventos');
  });

  it('filtrar actualiza chips, contador, índice y URL', async () => {
    const t = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    click(chip(t, 'play'));
    expect(chip(t, 'play').getAttribute('aria-pressed')).toBe('false');
    expect(counter(t)).toBe('3 / 4 eventos');
    expect(indexButtons(t).map((button) => button.disabled)).toEqual([false, false, true, false]);
    expect(window.location.search).toBe('?cat=work,study');

    click(chip(t, 'study'), { altKey: true });
    expect(counter(t)).toBe('2 / 4 eventos');
    expect(window.location.search).toBe('?cat=study');

    click([...t.filters.querySelectorAll<HTMLButtonElement>('.filters__bulk')][1]);
    expect(counter(t)).toBe('0 / 4 eventos');
    expect(window.location.search).toBe('?cat=');

    click([...t.filters.querySelectorAll<HTMLButtonElement>('.filters__bulk')][0]);
    expect(counter(t)).toBe('4 / 4 eventos');
    expect(window.location.search).toBe('');
  });

  it('el filtro de la URL se restaura al cargar', async () => {
    window.history.replaceState(null, '', '/?cat=work&private=0');
    const t = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    expect(['work', 'study', 'play'].map((id) => chip(t, id).getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(counter(t)).toBe('2 / 4 eventos');
    expect(window.location.search).toBe('?cat=work&private=0');
  });

  it('teclado: → enfoca, Enter abre el pop-up, → cambia de evento, Esc cierra y devuelve el foco, Esc suelta', async () => {
    const t = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    t.stage.tabIndex = 0;
    t.stage.focus();

    press(t.stage, 'ArrowRight');
    expect(t.popup.hidden).toBe(true);
    expect(t.announcer.textContent).toContain('Escuela');
    expect(indexButtons(t)[0].getAttribute('aria-current')).toBe('true');

    press(t.stage, 'Enter');
    expect(title(t)).toBe('Escuela');
    expect(document.activeElement).toBe(t.popup);
    expect(t.hud.classList.contains('hud--dimmed')).toBe(true);
    expect(t.popup.querySelector<HTMLButtonElement>('.popup__nav')?.disabled).toBe(true);

    press(t.popup, 'ArrowRight');
    expect(title(t)).toBe('Primer trabajo');
    press(t.popup, 'ArrowLeft');
    press(t.popup, 'ArrowLeft');
    expect(title(t)).toBe('Escuela');

    press(t.popup, 'Escape');
    expect(t.popup.hidden).toBe(true);
    expect(document.activeElement).toBe(t.stage);
    expect(indexButtons(t)[0].getAttribute('aria-current')).toBe('true');
    expect(t.hud.classList.contains('hud--dimmed')).toBe(false);

    press(t.stage, 'Escape');
    expect(t.index.querySelector('[aria-current]')).toBeNull();
    expect(t.announcer.textContent).toBe('');
  });

  it('desde el índice: abrir un evento, navegar con los botones del pop-up y cerrar con ✕', async () => {
    const t = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    click(t.indexToggle);
    expect(t.index.hidden).toBe(false);
    const opener = indexButtons(t)[2];
    opener.focus();
    click(opener);
    expect(title(t)).toBe('Proyecto paralelo');
    expect(t.popup.querySelector('.badge--branch')?.textContent).toContain('Primer trabajo');

    const next = [...t.popup.querySelectorAll<HTMLButtonElement>('.popup__nav')][1];
    next.focus();
    click(next);
    expect(title(t)).toBe('Segunda parte');
    expect(next.disabled).toBe(true);

    click(t.popup.querySelector<HTMLButtonElement>('.popup__close') as HTMLButtonElement);
    expect(t.popup.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('clic fuera cierra el pop-up; clic en filtros o escena no', async () => {
    const t = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    t.controller.onEventActivated('b-job');
    chip(t, 'study').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    t.stage.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(title(t)).toBe('Primer trabajo');
    t.hud.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(t.popup.hidden).toBe(true);
  });

  it('si un filtro oculta el evento abierto, el pop-up se cierra', async () => {
    const t = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    t.controller.onEventActivated('c-side');
    expect(title(t)).toBe('Proyecto paralelo');
    click(chip(t, 'play'));
    expect(t.popup.hidden).toBe(true);
    // …y ya no se puede volver a abrir mientras siga filtrado.
    t.controller.onEventActivated('c-side');
    expect(t.popup.hidden).toBe(true);
  });

  it('las flechas saltan los eventos filtrados', async () => {
    const t = await mountApp(jsonFetch({ [PERSONAL]: makeData() }));
    click(chip(t, 'work'), { detail: 2 }); // solo "work": b-job y e-side-two
    press(t.stage, 'ArrowRight');
    press(t.stage, 'Enter');
    expect(title(t)).toBe('Primer trabajo');
    press(t.popup, 'ArrowRight');
    expect(title(t)).toBe('Segunda parte');
    press(t.popup, 'ArrowRight');
    expect(title(t)).toBe('Segunda parte');
  });
});
