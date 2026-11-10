import { afterEach, describe, expect, it } from 'vitest';
import { NodeLabels } from '../../../src/infrastructure/dom/NodeLabels';
import type { ProjectedFrame, ProjectedNode } from '../../../src/infrastructure/three/types';
import { cleanupDom, mount, texts, translation, unsafeModel } from '../../helpers/dom';
import { buildModel, selection } from '../../helpers/fixtures';

afterEach(cleanupDom);

const VIEWPORT = { width: 1000, height: 600 };

/** Importancias en los datos: a-school 2, b-job 3, c-side 1, e-side-two 2. */
function node(eventId: string, x: number, y: number, overrides: Partial<ProjectedNode> = {}): ProjectedNode {
  const importance = { 'a-school': 2, 'b-job': 3, 'c-side': 1, 'e-side-two': 2 }[eventId] ?? 2;
  return { eventId, x, y, radius: 10, presence: 1, importance, inFront: true, highlighted: false, ...overrides };
}

function frame(nodes: ProjectedNode[], cameraDistance = 20): ProjectedFrame {
  return { nodes, years: [], nowX: null, cameraDistance, viewport: VIEWPORT };
}

function setup(keepClear: HTMLElement[] = []): { root: HTMLElement; labels: NodeLabels; label: (title: string) => HTMLElement } {
  const root = mount('div');
  const labels = new NodeLabels(root, keepClear);
  labels.render(buildModel());
  const label = (title: string): HTMLElement => {
    const found = [...root.querySelectorAll<HTMLElement>('.node-label')].find(
      (item) => item.querySelector('.node-label__title')?.textContent === title,
    );
    if (!found) throw new Error(`no hay rótulo ${title}`);
    return found;
  };
  return { root, labels, label };
}

const shown = (element: HTMLElement): boolean => element.classList.contains('node-label--shown');

describe('NodeLabels', () => {
  it('crea un rótulo decorativo por evento con título, año, importancia y color', () => {
    const { root, label } = setup();
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(texts(root, '.node-label__title')).toEqual(['Escuela', 'Primer trabajo', 'Proyecto paralelo', 'Segunda parte']);
    expect(texts(root, '.node-label__date')).toEqual(['2010', '2015', '2016', '2018']);
    expect(label('Primer trabajo').classList.contains('node-label--i3')).toBe(true);
    expect(label('Proyecto paralelo').classList.contains('node-label--i1')).toBe(true);
    expect(label('Escuela').style.getPropertyValue('--accent')).toBe('#6EA8FF');
    expect(root.querySelector('.node-label--shown')).toBeNull();
  });

  it('muestra los rótulos bajo su nodo, centrados en su X', () => {
    const { labels, label } = setup();
    labels.onProjected(frame([node('a-school', 200, 100), node('b-job', 600, 300)]));
    expect(shown(label('Escuela'))).toBe(true);
    expect(shown(label('Primer trabajo'))).toBe(true);
    expect(shown(label('Proyecto paralelo'))).toBe(false);
    // y = 100 + (radio 10 × 2,1 + 10) = 131
    expect(translation(label('Escuela'))).toEqual([200, 131]);
    expect(label('Escuela').style.transform).toContain('translateX(-50%)');
  });

  it('si no cabe debajo, lo coloca encima del nodo', () => {
    const { labels, label } = setup();
    labels.onProjected(frame([node('a-school', 200, 590)]));
    // y = 590 − 31 − alto del rótulo (34) = 525
    expect(translation(label('Escuela'))).toEqual([200, 525]);
  });

  it('desde lejos solo se rotulan los nodos importantes', () => {
    const { labels, label } = setup();
    const nodes = [node('a-school', 100, 100), node('b-job', 400, 100), node('c-side', 700, 100)];
    labels.onProjected(frame(nodes, 20));
    expect([shown(label('Escuela')), shown(label('Primer trabajo')), shown(label('Proyecto paralelo'))]).toEqual([true, true, true]);
    labels.onProjected(frame(nodes, 45));
    expect([shown(label('Escuela')), shown(label('Primer trabajo')), shown(label('Proyecto paralelo'))]).toEqual([true, true, false]);
    labels.onProjected(frame(nodes, 90));
    expect([shown(label('Escuela')), shown(label('Primer trabajo')), shown(label('Proyecto paralelo'))]).toEqual([false, true, false]);
  });

  it('el nodo enfocado o resaltado se rotula siempre, aunque esté lejos', () => {
    const { labels, label } = setup();
    labels.applySelection(selection('c-side'));
    labels.onProjected(frame([node('c-side', 700, 100), node('a-school', 100, 100, { highlighted: true })], 90));
    expect(shown(label('Proyecto paralelo'))).toBe(true);
    expect(label('Proyecto paralelo').classList.contains('node-label--focused')).toBe(true);
    expect(shown(label('Escuela'))).toBe(true);
    expect(label('Escuela').classList.contains('node-label--focused')).toBe(false);

    labels.applySelection(selection(null));
    labels.onProjected(frame([node('c-side', 700, 100)], 90));
    expect(shown(label('Proyecto paralelo'))).toBe(false);
    expect(label('Proyecto paralelo').classList.contains('node-label--focused')).toBe(false);
  });

  it('no rotula nodos filtrados (atenuados), detrás de la cámara o que han salido del fotograma', () => {
    const { labels, label } = setup();
    labels.onProjected(frame([node('a-school', 100, 100), node('b-job', 400, 100), node('e-side-two', 700, 100)]));
    labels.onProjected(
      frame([node('a-school', 100, 100, { presence: 0.1 }), node('b-job', 400, 100, { inFront: false }), node('fantasma', 10, 10)]),
    );
    expect(shown(label('Escuela'))).toBe(false);
    expect(shown(label('Primer trabajo'))).toBe(false);
    expect(shown(label('Segunda parte'))).toBe(false);
  });

  it('ante un solape gana el nodo con más prioridad (el enfocado) y el otro busca hueco', () => {
    const { labels, label } = setup();
    labels.applySelection(selection('a-school'));
    labels.onProjected(frame([node('a-school', 300, 200), node('b-job', 310, 200)]));
    expect(translation(label('Escuela'))).toEqual([300, 231]);
    expect(shown(label('Primer trabajo'))).toBe(true);
    expect(translation(label('Primer trabajo'))).toEqual([310, 135]);
  });

  it('un rótulo no tapa el disco de otro nodo', () => {
    const { labels, label } = setup();
    // El disco de b-job cae justo donde iría el rótulo de a-school (debajo); arriba no cabe.
    labels.onProjected(frame([node('a-school', 300, 20), node('b-job', 300, 60, { presence: 1 })], 20));
    expect(shown(label('Escuela'))).toBe(false);
    // Un nodo atenuado no cuenta como obstáculo.
    labels.onProjected(frame([node('a-school', 300, 20), node('b-job', 300, 60, { presence: 0.1 })], 20));
    expect(shown(label('Escuela'))).toBe(true);
  });

  it('evita las zonas de interfaz reservadas (cabecera, filtros), medidas respecto a su contenedor', () => {
    const hud = mount('div');
    const collapsed = mount('div');
    hud.getBoundingClientRect = (): DOMRect => new DOMRect(50, 70, 400, 120);
    collapsed.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 0, 0);
    const { root, labels, label } = setup([hud, collapsed]);
    root.getBoundingClientRect = (): DOMRect => new DOMRect(50, 20, 1000, 600);
    // Zona reservada relativa al contenedor: x 0–400, y 50–170.
    labels.onProjected(frame([node('a-school', 200, 80), node('b-job', 700, 80)]));
    expect(shown(label('Escuela'))).toBe(false);
    expect(shown(label('Primer trabajo'))).toBe(true);
  });

  it('las zonas reservadas se vuelven a medir solo cada 20 fotogramas', () => {
    const hud = mount('div');
    let measured = 0;
    hud.getBoundingClientRect = (): DOMRect => {
      measured += 1;
      return new DOMRect(0, 0, 10, 10);
    };
    const { labels } = setup([hud]);
    for (let i = 0; i < 41; i += 1) labels.onProjected(frame([]));
    expect(measured).toBe(3);
  });

  it('el ancho estimado crece con el título y tiene un máximo (se nota al apartarlo del borde)', () => {
    const root = mount('div');
    const labels = new NodeLabels(root);
    labels.render(
      unsafeModel(buildModel(), {
        events: { 'a-school': { title: 'x'.repeat(200) }, 'e-side-two': { title: 'y' } },
      }),
    );
    // Un nodo pegado al borde izquierdo: el rótulo se desplaza hasta que cabe entero (margen 8 px).
    labels.onProjected(frame([node('a-school', 4, 100), node('e-side-two', 4, 300)]));
    const [long, , , short] = [...root.querySelectorAll<HTMLElement>('.node-label')];
    expect(shown(long)).toBe(true);
    expect(shown(short)).toBe(true);
    // Largo: ancho máximo 230 → centro en 8 + 115. Corto: 1 × 7 + 18 = 25 → centro en 8 + 12,5.
    expect(translation(long)[0]).toBe(123);
    expect(translation(short)[0]).toBeCloseTo(20.5);
  });

  it('un rótulo de un nodo junto al borde derecho tampoco se corta', () => {
    const { labels, label } = setup();
    labels.onProjected(frame([node('b-job', VIEWPORT.width - 2, 100)]));
    const [x] = translation(label('Primer trabajo'));
    expect(x).toBeLessThan(VIEWPORT.width - 2);
    expect(shown(label('Primer trabajo'))).toBe(true);
  });

  it('no rotula un nodo cuyo centro ya está fuera de pantalla', () => {
    const { labels, label } = setup();
    labels.onProjected(frame([node('b-job', -5, 100), node('a-school', VIEWPORT.width + 5, 100)]));
    expect(shown(label('Primer trabajo'))).toBe(false);
    expect(shown(label('Escuela'))).toBe(false);
  });

  it('usa el título corto (shortTitle) si existe', () => {
    const root = mount('div');
    const labels = new NodeLabels(root);
    labels.render(unsafeModel(buildModel(), { events: { 'b-job': { title: 'Un título larguísimo de verdad', shortTitle: 'Corto' } } }));
    expect(texts(root, '.node-label__title')).toContain('Corto');
    expect(texts(root, '.node-label__title')).not.toContain('Un título larguísimo de verdad');
  });

  it('un evento sin categoría conocida usa un acento neutro', () => {
    const root = mount('div');
    new NodeLabels(root).render(unsafeModel(buildModel(), { categories: [] }));
    expect(root.querySelector<HTMLElement>('.node-label')?.style.getPropertyValue('--accent')).toBe('#ffffff');
  });

  it('seguridad: los títulos se escriben como texto', () => {
    const root = mount('div');
    new NodeLabels(root).render(unsafeModel(buildModel(), { events: { 'a-school': { title: '<img src=x onerror=alert(1)>' } } }));
    expect(root.querySelector('img')).toBeNull();
    expect(texts(root, '.node-label__title')[0]).toBe('<img src=x onerror=alert(1)>');
  });
});
