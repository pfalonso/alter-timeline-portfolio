import { afterEach, describe, expect, it } from 'vitest';
import { Tooltip } from '../../../src/infrastructure/dom/Tooltip';
import { cleanupDom, mount, unsafeModel } from '../../helpers/dom';
import { buildModel } from '../../helpers/fixtures';

afterEach(cleanupDom);

function setup(): { root: HTMLElement; tooltip: Tooltip } {
  const root = mount('div');
  const tooltip = new Tooltip(root);
  tooltip.render(buildModel());
  return { root, tooltip };
}

describe('Tooltip', () => {
  it('es un role="tooltip" y empieza oculto', () => {
    const { root } = setup();
    expect(root.getAttribute('role')).toBe('tooltip');
    expect(root.hidden).toBe(true);
  });

  it('al pasar sobre un nodo muestra categoría, título y fechas junto al puntero', () => {
    const { root, tooltip } = setup();
    tooltip.onNodeHover('a-school', { x: 120.4, y: 80.6 });
    expect(root.hidden).toBe(false);
    expect(root.querySelector('.tooltip__title')?.textContent).toBe('Escuela');
    expect(root.querySelector('.tooltip__dates')?.textContent).toBe('2010 — 2014');
    expect(root.querySelector('.tooltip__category')?.textContent).toBe('Estudios');
    expect(root.style.getPropertyValue('--accent')).toBe('#6EA8FF');
    expect(root.style.transform).toMatch(/^translate3d\(120px, 81px, 0(px)?\)$/);
    expect(root.classList.contains('tooltip--flip')).toBe(false);
  });

  it('un evento en curso muestra "actualidad"', () => {
    const { root, tooltip } = setup();
    tooltip.onNodeHover('b-job', { x: 0, y: 0 });
    expect(root.querySelector('.tooltip__dates')?.textContent).toMatch(/— actualidad$/);
  });

  it('cerca del borde derecho se voltea para no salirse de la ventana', () => {
    const { root, tooltip } = setup();
    tooltip.onNodeHover('a-school', { x: window.innerWidth - 100, y: 10 });
    expect(root.classList.contains('tooltip--flip')).toBe(true);
    tooltip.onNodeHover('a-school', { x: 100, y: 10 });
    expect(root.classList.contains('tooltip--flip')).toBe(false);
  });

  it('sigue al puntero y cambia de contenido al cambiar de nodo', () => {
    const { root, tooltip } = setup();
    tooltip.onNodeHover('a-school', { x: 10, y: 10 });
    tooltip.onNodeHover('a-school', { x: 30, y: 40 });
    expect(root.style.transform).toMatch(/^translate3d\(30px, 40px, 0(px)?\)$/);
    tooltip.onNodeHover('c-side', { x: 30, y: 40 });
    expect(root.querySelector('.tooltip__title')?.textContent).toBe('Proyecto paralelo');
    expect(root.style.getPropertyValue('--accent')).toBe('#B48CFF');
  });

  it('se oculta al salir del nodo y reaparece con su contenido al volver', () => {
    const { root, tooltip } = setup();
    tooltip.onNodeHover('a-school', { x: 10, y: 10 });
    tooltip.onNodeHover(null, { x: 0, y: 0 });
    expect(root.hidden).toBe(true);
    tooltip.onNodeHover('a-school', { x: 10, y: 10 });
    expect(root.hidden).toBe(false);
    expect(root.querySelector('.tooltip__title')?.textContent).toBe('Escuela');
  });

  it('un id desconocido (o un evento privado oculto) lo oculta', () => {
    const { root, tooltip } = setup();
    tooltip.onNodeHover('a-school', { x: 10, y: 10 });
    tooltip.onNodeHover('d-secret', { x: 10, y: 10 });
    expect(root.hidden).toBe(true);
  });

  it('antes de pintar el modelo no muestra nada', () => {
    const root = mount('div');
    const tooltip = new Tooltip(root);
    tooltip.onNodeHover('a-school', { x: 10, y: 10 });
    expect(root.hidden).toBe(true);
  });

  it('si el evento no tiene categoría conocida, no muestra etiqueta y usa un acento neutro', () => {
    const root = mount('div');
    const tooltip = new Tooltip(root);
    tooltip.render(unsafeModel(buildModel(), { categories: [] }));
    tooltip.onNodeHover('a-school', { x: 1, y: 1 });
    expect(root.hidden).toBe(false);
    expect(root.querySelector('.tooltip__category')?.textContent).toBe('');
    expect(root.style.getPropertyValue('--accent')).toBe('#ffffff');
  });

  it('seguridad: el título se escribe como texto', () => {
    const root = mount('div');
    const tooltip = new Tooltip(root);
    tooltip.render(unsafeModel(buildModel(), { events: { 'a-school': { title: '<img src=x onerror=alert(1)>' } } }));
    tooltip.onNodeHover('a-school', { x: 1, y: 1 });
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.tooltip__title')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
