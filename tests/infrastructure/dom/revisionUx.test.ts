import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModes, InteractionHint } from '../../../src/infrastructure/dom/AppModes';
import { contactActions, emailAction } from '../../../src/infrastructure/dom/contactActions';
import { EventPopup } from '../../../src/infrastructure/dom/EventPopup';
import { FilterSummary } from '../../../src/infrastructure/dom/FilterSummary';
import { GhostLabels } from '../../../src/infrastructure/dom/GhostLabels';
import { icon, iconForLink } from '../../../src/infrastructure/dom/icons';
import { layoutLabels } from '../../../src/infrastructure/dom/labelLayout';
import { NodeLabels } from '../../../src/infrastructure/dom/NodeLabels';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { ViewControls } from '../../../src/infrastructure/dom/ViewControls';
import type { ProjectedFrame, ProjectedNode } from '../../../src/infrastructure/three/types';
import { cleanupDom, click, mount, press, texts } from '../../helpers/dom';
import { buildModel, fakeHandlers, makeData, makeLifeLinesData, makeStoryData, selection } from '../../helpers/fixtures';
import { makeUnionData } from '../../helpers/unionFixtures';

afterEach(cleanupDom);

const VIEWPORT = { width: 1000, height: 600 };
const frame = (nodes: ProjectedNode[], extra: Partial<ProjectedFrame> = {}): ProjectedFrame => ({
  nodes,
  years: [],
  nowX: null,
  cameraDistance: 20,
  viewport: VIEWPORT,
  ...extra,
});
const node = (eventId: string, x: number, y: number, importance = 2): ProjectedNode => ({
  eventId,
  x,
  y,
  radius: 10,
  presence: 1,
  importance,
  inFront: true,
  highlighted: false,
});

describe('iconos propios', () => {
  it('un SVG decorativo de trazo, sin texto', () => {
    const svg = icon('mail');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toBe('icon icon--mail');
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(svg.textContent).toBe('');
  });

  it('elige el icono de un enlace por su texto o su dominio', () => {
    expect(iconForLink('Demo reel VFX', 'https://youtu.be/x')).toBe('play');
    expect(iconForLink('GitHub', 'https://github.com/x')).toBe('code');
    expect(iconForLink('LinkedIn', 'https://linkedin.com/in/x')).toBe('person');
    expect(iconForLink('ArtStation', 'https://artstation.com/x')).toBe('image');
    expect(iconForLink('Escríbeme', 'mailto:a@b.c')).toBe('mail');
    expect(iconForLink('CV (PDF)', '/cv/a.pdf')).toBe('doc');
    expect(iconForLink('Blog', 'https://example.com')).toBe('link');
  });
});

describe('acciones de contacto', () => {
  it('descarta URLs peligrosas y rutas con «..»; el correo debe ser válido', () => {
    const meta = {
      ...makeData().meta,
      email: 'no es correo',
      cv: [{ label: 'Malo', url: '/cv/../x.pdf' }, { label: 'JS', url: 'javascript:alert(1)' }],
      contact: [{ label: 'Data', url: 'data:text/html,x' }],
    };
    expect(contactActions(meta)).toEqual([]);
    expect(emailAction('x', 'action')).toBeNull();
  });

  it('copiar el correo usa el portapapeles si existe; si no, no falla', async () => {
    const group = emailAction('ada@example.com', 'action') as HTMLElement;
    const copy = group.querySelector('.action__copy') as HTMLButtonElement;
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    click(copy);
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('ada@example.com');
    expect(copy.classList.contains('action__copy--done')).toBe(true);
    expect(copy.title).toBe(STRINGS.copied);
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    expect(() => click(copy)).not.toThrow();
  });
});

describe('FilterSummary', () => {
  it('sin filtros no dice nada; con filtro, el resultado en lenguaje natural y «Mostrar todo»', () => {
    const root = mount('p');
    const summary = new FilterSummary(root);
    const handlers = fakeHandlers();
    summary.bind(handlers);
    summary.render(buildModel(makeLifeLinesData()));
    summary.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(['a', 'b']), totalEvents: 2 });
    expect(root.hidden).toBe(true);
    summary.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(['a']), totalEvents: 2 });
    expect(root.hidden).toBe(false);
    expect(texts(root, '.filters__result-text')).toEqual([STRINGS.filterResult(1, 2)]);
    summary.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(['a']), totalEvents: 2, isolatedLine: 'food' });
    expect(texts(root, '.filters__result-text')).toEqual([STRINGS.isolatedResult('Cocina', 1, 2)]);
    click(root.querySelector('.filters__reset') as HTMLElement);
    expect(handlers.onFiltersReset).toHaveBeenCalledTimes(1);
  });
});

describe('AppModes e InteractionHint', () => {
  it('con una ficha abierta la app recoge la interfaz', () => {
    const app = mount('div');
    const modes = new AppModes(app);
    modes.applySelection(selection('b-job', true));
    expect(app.classList.contains('app--detail')).toBe(true);
    modes.applySelection(selection('b-job', false));
    expect(app.classList.contains('app--detail')).toBe(false);
  });

  it('la pista desaparece tras la primera interacción (arrastre, rueda o flechas) y no vuelve', () => {
    for (const trigger of ['pointerdown', 'wheel', 'arrow'] as const) {
      const hint = mount('p');
      const stage = mount('div');
      const keys = mount('div');
      const once = new InteractionHint(hint, STRINGS.hintKeys, stage, keys);
      expect(hint.textContent).toBe(STRINGS.hintKeys);
      press(keys, 'a');
      expect(once.dismissed).toBe(false);
      if (trigger === 'arrow') press(keys, 'ArrowRight');
      else stage.dispatchEvent(new Event(trigger));
      expect(once.dismissed).toBe(true);
      expect(hint.hidden).toBe(true);
      once.dismiss();
      expect(hint.classList.contains('help--gone')).toBe(true);
    }
  });
});

describe('ViewControls: iconos con rótulo y atajos tras «?»', () => {
  it('el botón «?» despliega la lista de atajos; Esc y un clic fuera la pliegan', () => {
    const root = mount('div');
    const help = mount('div', { id: 'shortcuts' });
    new ViewControls(root, { zoomBy: vi.fn(), showOverview: vi.fn() }, mount('div'), help);
    const toggle = root.querySelector<HTMLButtonElement>('.controls__button--help') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe(STRINGS.help);
    expect(toggle.getAttribute('aria-controls')).toBe('shortcuts');
    expect(help.hidden).toBe(true);
    expect(texts(help, 'dt')).toHaveLength(STRINGS.helpItems.length);
    click(toggle);
    expect(help.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    press(help, 'Escape');
    expect(help.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    click(toggle);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(help.hidden).toBe(true);
    press(help, 'a');
    // Cada botón de cámara lleva su rótulo (data-tip) para mostrarlo con el ratón o el foco.
    expect([...root.querySelectorAll('[data-tip]')].map((button) => button.getAttribute('data-tip'))).toEqual([
      STRINGS.zoomIn,
      STRINGS.zoomOut,
      STRINGS.overview,
      STRINGS.help,
    ]);
  });
});

describe('labelLayout: el rótulo forzado (momento activo de la historia)', () => {
  it('se coloca aunque todos sus huecos rocen la interfaz, sin pisar otro rótulo', () => {
    const reserved = [{ left: 0, right: 1000, top: 0, bottom: 600 }];
    const placed = layoutLabels(
      [
        { id: 'a', x: 500, ys: [100, 300], width: 100, height: 30, priority: 1000, force: true },
        { id: 'b', x: 500, ys: [100], width: 100, height: 30, priority: 10 },
      ],
      VIEWPORT,
      [],
      reserved,
    );
    expect(placed.get('a')).toBe(100);
    expect(placed.has('b')).toBe(false);
    // Si ningún hueco cabe en pantalla, no se coloca.
    expect(layoutLabels([{ id: 'c', x: 500, ys: [-50, 700], width: 10, height: 30, priority: 1, force: true }], VIEWPORT).has('c')).toBe(false);
  });
});

describe('NodeLabels: apertura sin rótulos y momento activo siempre rotulado', () => {
  it('durante la espera de la apertura no se rotula nada; después, sí', () => {
    let now = 0;
    const root = mount('div');
    const labels = new NodeLabels(root, [], { openingHoldMs: 1000, clock: () => now });
    labels.render(buildModel());
    labels.onProjected(frame([node('b-job', 500, 300, 3)]));
    expect(root.querySelectorAll('.node-label--shown')).toHaveLength(0);
    now = 1500;
    labels.onProjected(frame([node('b-job', 500, 300, 3)]));
    expect(root.querySelectorAll('.node-label--shown')).toHaveLength(1);
    expect(labels.occupied()).toHaveLength(1);
  });

  it('en la historia, el paso activo se rotula aunque la interfaz tape sus huecos', () => {
    const blocker = mount('div');
    blocker.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 1000, 600);
    const root = mount('div');
    const labels = new NodeLabels(root, [blocker]);
    labels.render(buildModel(makeStoryData()));
    labels.applySelection({ ...selection('a-school', true), story: { index: 0, total: 4, eventId: 'a-school', fromEventId: null, arcId: null, newChapter: false } });
    labels.onProjected(frame([node('a-school', 500, 300), node('e-side-two', 700, 300)]));
    const shown = [...root.querySelectorAll('.node-label--shown')].map((label) => label.querySelector('.node-label__title')?.textContent);
    expect(shown).toEqual(['Escuela']);
  });
});

describe('GhostLabels: un camino que no fue nunca pisa otro rótulo', () => {
  it('se oculta si su caja toca una zona ocupada', () => {
    const model = buildModel(makeUnionData());
    const ghost = model.layout.ghosts[0];
    const root = mount('div');
    let occupied = [{ left: 0, right: 1000, top: 0, bottom: 600 }];
    const labels = new GhostLabels(root, () => occupied);
    labels.render(model);
    const projected = frame([], { cameraDistance: 10, ghosts: [{ id: ghost.id, x: 400, y: 300, inFront: true, side: 1 }] });
    labels.onProjected(projected);
    expect(root.querySelector('.ghost-label--shown')).toBeNull();
    occupied = [];
    labels.onProjected(projected);
    expect(root.querySelector('.ghost-label--shown')).not.toBeNull();
  });
});

describe('EventPopup: hoja inferior (móvil) y «hay más abajo»', () => {
  function setup() {
    const root = mount('aside');
    const popup = new EventPopup(root);
    const handlers = fakeHandlers();
    popup.bind(handlers);
    popup.render(buildModel());
    popup.applySelection(selection('b-job', true));
    const handle = root.querySelector<HTMLButtonElement>('.popup__handle') as HTMLButtonElement;
    const drag = (dy: number): void => {
      handle.dispatchEvent(Object.assign(new Event('pointerdown'), { clientY: 300 }));
      handle.dispatchEvent(Object.assign(new Event('pointerup'), { clientY: 300 + dy }));
      click(handle);
    };
    return { root, popup, handlers, handle, drag };
  }

  it('el asa amplía y reduce; arrastrar hacia abajo con la hoja reducida la cierra', () => {
    const { root, handlers, handle, drag } = setup();
    click(handle);
    expect(root.classList.contains('popup--expanded')).toBe(true);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    drag(120);
    expect(root.classList.contains('popup--expanded')).toBe(false);
    drag(-80);
    expect(root.classList.contains('popup--expanded')).toBe(true);
    drag(120);
    drag(120);
    expect(handlers.onDetailClosed).toHaveBeenCalledTimes(1);
    handle.dispatchEvent(Object.assign(new Event('pointerup'), { clientY: 0 }));
  });

  it('en la historia, arrastrar hacia abajo sale de la historia', () => {
    const { popup, handlers, drag } = setup();
    popup.applySelection({ ...selection('b-job', true), story: { index: 0, total: 2, eventId: 'b-job', fromEventId: null, arcId: null, newChapter: false } });
    drag(120);
    expect(handlers.onStoryExit).toHaveBeenCalledTimes(1);
  });

  it('marca «hay más» mientras quede contenido bajo el pie', () => {
    const { root } = setup();
    const body = root.querySelector('.popup__body') as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 400, configurable: true });
    body.dispatchEvent(new Event('scroll'));
    expect(root.classList.contains('popup--more')).toBe(true);
    body.scrollTop = 500;
    body.dispatchEvent(new Event('scroll'));
    expect(root.classList.contains('popup--more')).toBe(false);
  });
});
