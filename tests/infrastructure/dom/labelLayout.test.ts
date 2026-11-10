import { describe, expect, it } from 'vitest';
import { labelDistanceLimit, layoutLabels, yearStep, type LabelCandidate } from '../../../src/infrastructure/dom/labelLayout';

const VIEWPORT = { width: 800, height: 600 };

function candidate(id: string, x: number, ys: number[], priority = 0, width = 100, height = 30): LabelCandidate {
  return { id, x, ys, width, height, priority };
}

describe('layoutLabels', () => {
  it('coloca cada etiqueta en su posición preferida si no hay conflicto', () => {
    const placed = layoutLabels([candidate('a', 200, [100, 50]), candidate('b', 500, [300])], VIEWPORT);
    expect(Object.fromEntries(placed)).toEqual({ a: 100, b: 300 });
  });

  it('si dos se pisan, gana la de mayor prioridad y la otra prueba su alternativa', () => {
    const placed = layoutLabels([candidate('low', 200, [100, 200], 1), candidate('high', 210, [100, 200], 5)], VIEWPORT);
    expect(Object.fromEntries(placed)).toEqual({ high: 100, low: 200 });
  });

  it('una etiqueta sin hueco en ninguna alternativa no se muestra', () => {
    const placed = layoutLabels([candidate('low', 200, [100], 1), candidate('high', 210, [100], 5)], VIEWPORT);
    expect([...placed.keys()]).toEqual(['high']);
  });

  it('a igual prioridad desempata por id (determinista)', () => {
    const a = layoutLabels([candidate('b', 200, [100]), candidate('a', 200, [100])], VIEWPORT);
    const b = layoutLabels([candidate('a', 200, [100]), candidate('b', 200, [100])], VIEWPORT);
    expect([...a.keys()]).toEqual(['a']);
    expect([...b.keys()]).toEqual(['a']);
  });

  it('el margen (padding) separa etiquetas que casi se tocan', () => {
    const touching = [candidate('a', 100, [100], 2), candidate('b', 204, [100], 1)];
    expect(layoutLabels(touching, VIEWPORT).size).toBe(1);
    expect(layoutLabels(touching, VIEWPORT, [], [], 0).size).toBe(2);
  });

  it('descarta posiciones que se salen por arriba o por abajo', () => {
    const placed = layoutLabels([candidate('top', 200, [-5, 40]), candidate('bottom', 500, [580]), candidate('fits', 650, [570])], VIEWPORT);
    expect(Object.fromEntries(placed)).toEqual({ top: 40, fits: 570 });
  });

  it('descarta etiquetas totalmente fuera por los lados, pero admite las que asoman', () => {
    const placed = layoutLabels(
      [candidate('left-out', -60, [100]), candidate('right-out', 860, [100]), candidate('left-edge', -40, [200]), candidate('right-edge', 840, [300])],
      VIEWPORT,
    );
    expect([...placed.keys()].sort()).toEqual(['left-edge', 'right-edge']);
  });

  it('no tapa el disco de OTRO nodo, pero sí puede pegarse al suyo', () => {
    const obstacles = [
      { id: 'other', x: 200, y: 110, radius: 10 },
      { id: 'own', x: 500, y: 110, radius: 10 },
    ];
    const placed = layoutLabels([candidate('a', 200, [100, 200]), candidate('own', 500, [100])], VIEWPORT, obstacles);
    expect(Object.fromEntries(placed)).toEqual({ a: 200, own: 100 });
  });

  it('respeta las zonas reservadas por la interfaz', () => {
    const reserved = [{ left: 0, right: 300, top: 0, bottom: 120 }];
    const placed = layoutLabels([candidate('a', 200, [100, 300]), candidate('b', 600, [100])], VIEWPORT, [], reserved);
    expect(Object.fromEntries(placed)).toEqual({ a: 300, b: 100 });
  });

  it('sin candidatos devuelve un mapa vacío', () => {
    expect(layoutLabels([], VIEWPORT).size).toBe(0);
  });
});

describe('yearStep', () => {
  it.each([
    [100, 1],
    [56, 1],
    [55, 2],
    [28, 2],
    [20, 5],
    [6, 10],
    [3, 20],
    [1.2, 50],
    [0.5, 100],
  ])('con %f px por año rotula cada %i años', (pixelsPerYear, expected) => {
    expect(yearStep(pixelsPerYear)).toBe(expected);
  });

  it('valores no válidos caen a 10', () => {
    expect(yearStep(0)).toBe(10);
    expect(yearStep(-5)).toBe(10);
    expect(yearStep(Number.NaN)).toBe(10);
  });

  it('el espaciado mínimo es configurable', () => {
    expect(yearStep(30, 30)).toBe(1);
    expect(yearStep(30, 100)).toBe(5);
  });
});

describe('labelDistanceLimit', () => {
  it('cuanto más importante el nodo, desde más lejos se rotula', () => {
    expect(labelDistanceLimit(3)).toBe(Infinity);
    expect(labelDistanceLimit(4)).toBe(Infinity);
    expect(labelDistanceLimit(2)).toBe(58);
    expect(labelDistanceLimit(1)).toBe(30);
    expect(labelDistanceLimit(1)).toBeLessThan(labelDistanceLimit(2));
  });
});
