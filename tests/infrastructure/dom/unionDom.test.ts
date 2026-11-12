import { afterEach, describe, expect, it } from 'vitest';
import { EventPopup } from '../../../src/infrastructure/dom/EventPopup';
import { GhostLabels } from '../../../src/infrastructure/dom/GhostLabels';
import { LineLegend } from '../../../src/infrastructure/dom/LineLegend';
import { NodeLabels } from '../../../src/infrastructure/dom/NodeLabels';
import type { ProjectedFrame } from '../../../src/infrastructure/three/types';
import { cleanupDom, mount, texts } from '../../helpers/dom';
import { buildModel, makeData, selection } from '../../helpers/fixtures';
import { makeUnionData } from '../../helpers/unionFixtures';

afterEach(cleanupDom);

const NOW = new Date(Date.UTC(2020, 0, 1));
const model = buildModel(makeUnionData(), { now: NOW });
const VIEWPORT = { width: 1000, height: 600 };
const frame = (overrides: Partial<ProjectedFrame> = {}): ProjectedFrame => ({ nodes: [], years: [], nowX: null, cameraDistance: 20, viewport: VIEWPORT, ...overrides });

describe('NodeLabels: activos y encrucijadas', () => {
  it('«En activo» junto al rótulo; las encrucijadas de ≥ 4 líneas se rotulan como mayores', () => {
    const root = mount('div');
    const labels = new NodeLabels(root);
    labels.render(model);
    expect(texts(root, '.node-label__active')).toEqual(['En activo']);
    const accident = [...root.querySelectorAll('.node-label')].find((item) => item.textContent?.startsWith('e-accident'));
    expect(accident?.classList.contains('node-label--i3')).toBe(true);
    expect(accident?.classList.contains('node-label--union')).toBe(true);
    // Lejos (vista general) se rotula igualmente.
    labels.onProjected(frame({ cameraDistance: 400, nodes: [{ eventId: 'e-accident', x: 500, y: 300, radius: 10, presence: 1, importance: 2, inFront: true, highlighted: false }] }));
    expect(accident?.classList.contains('node-label--shown')).toBe(true);
  });
});

describe('GhostLabels', () => {
  it('un rótulo en cursiva por camino que no fue, solo al acercarse y del lado de su hebra', () => {
    const root = mount('div');
    const labels = new GhostLabels(root);
    labels.render(model);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(texts(root, '.ghost-label')).toEqual(['Derecho', 'Arquitectura']);
    const ghosts = [
      { id: 'derecho', x: 100, y: 200, inFront: true, side: 1 as const },
      { id: 'arquitectura', x: 100, y: 260, inFront: true, side: -1 as const },
    ];
    labels.onProjected(frame({ ghosts }));
    const [up, down] = [...root.querySelectorAll<HTMLElement>('.ghost-label')];
    expect(up.classList.contains('ghost-label--shown')).toBe(true);
    expect(up.style.transform).toContain('188px');
    expect(up.style.transform).toContain('-100%');
    expect(down.style.transform).toContain('272px');
    labels.onProjected(frame({ ghosts, cameraDistance: 300 }));
    expect(up.classList.contains('ghost-label--shown')).toBe(false);
    labels.onProjected(frame({ ghosts: [ghosts[0]] }));
    expect(down.classList.contains('ghost-label--shown')).toBe(false);
    labels.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 0, layout: { ...model.layout, ghosts: [] } });
    expect(root.children).toHaveLength(0);
    labels.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 0 });
    labels.onProjected(frame());
  });
});

describe('EventPopup: líneas de un nodo de unión y «En activo»', () => {
  it('chips «Líneas:» con todas las líneas que pasan por el nodo, cada una de su color', () => {
    const popup = new EventPopup(mount('div'));
    popup.render(model);
    popup.applySelection(selection('e-accident', true));
    expect(texts(document.body, '.popup__lines-label')).toEqual(['Líneas:']);
    expect(texts(document.body, '.popup__lines .badge--line')).toEqual(['Vida', 'Tecnología', 'Arte', 'Cocina']);
    popup.applySelection(selection('e-tech2', true));
    expect(texts(document.body, '.badge--active')).toEqual(['En activo']);
    expect(texts(document.body, '.badge--line')).toEqual(['Línea: Tecnología']);
  });
});

describe('LineLegend: claves', () => {
  it('encrucijada, en activo y camino que no fue solo si aparecen en los datos; los ghosts no son líneas', () => {
    const root = mount('div');
    new LineLegend(root, null, { fallbackColor: '#fff' }).render(model);
    expect(texts(root, '.key__label')).toEqual(['Encrucijada', 'En activo', 'Camino que no fue']);
    expect(root.querySelector('[data-branch="derecho"]')).toBeNull();
    const plain = mount('div');
    const data = makeData();
    data.branches = [{ id: 'main', label: 'Principal' }, { id: 'side', label: 'Lado' }];
    new LineLegend(plain, null, { fallbackColor: '#fff' }).render(buildModel(data));
    expect(plain.querySelector('.lines__keys')).toBeNull();
  });
});
