import { describe, expect, it } from 'vitest';
import {
  bandFraction,
  bandOffset,
  clamp,
  createRandom,
  damp,
  lerp,
  PathTable,
  pickNode,
  smoothstep,
  verticalExtent,
  type Pickable,
  routeAlong,
} from '../../../src/infrastructure/three/math';

describe('clamp / lerp / smoothstep', () => {
  it('clamp acota a [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('lerp interpola (y extrapola) linealmente', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 2)).toBe(30);
  });

  it('smoothstep: 0 antes del borde, 1 después, suave y simétrico en medio', () => {
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 5)).toBe(1);
    expect(smoothstep(2, 4, 3)).toBe(0.5);
    expect(smoothstep(2, 4, 2.5)).toBeCloseTo(0.15625, 10);
    expect(smoothstep(2, 4, 2.5) + smoothstep(2, 4, 3.5)).toBeCloseTo(1, 10);
  });
});

describe('damp', () => {
  it('se acerca al objetivo sin pasarse y converge', () => {
    let value = 0;
    let previous = 0;
    for (let i = 0; i < 600; i += 1) {
      value = damp(value, 10, 4, 1 / 60);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(10);
      previous = value;
    }
    expect(value).toBeCloseTo(10, 6);
    expect(damp(0, 10, 4, 1 / 60)).toBeGreaterThan(0);
  });

  it('es independiente del framerate: dos pasos de dt/2 equivalen a uno de dt', () => {
    const once = damp(0, 10, 3, 0.1);
    const twice = damp(damp(0, 10, 3, 0.05), 10, 3, 0.05);
    expect(twice).toBeCloseTo(once, 10);
  });

  it('con dt = 0 no se mueve', () => {
    expect(damp(3, 10, 5, 0)).toBe(3);
  });
});

describe('createRandom', () => {
  it('es determinista por semilla y devuelve valores en [0, 1)', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    const values = Array.from({ length: 500 }, () => a());
    expect(values).toEqual(Array.from({ length: 500 }, () => b()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(new Set(values).size).toBeGreaterThan(490);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  it('semillas distintas dan secuencias distintas', () => {
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });
});

describe('PathTable', () => {
  const L = [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 3, y: 4, z: 0 },
  ];
  const at = (table: PathTable, t: number): number[] => {
    const out = [0, 0, 0];
    table.sample(t, out);
    return out;
  };

  it('necesita al menos dos puntos', () => {
    expect(() => new PathTable([])).toThrow(/dos puntos/);
    expect(() => new PathTable([{ x: 0, y: 0, z: 0 }])).toThrow(/dos puntos/);
  });

  it('length es la longitud de la polilínea', () => {
    expect(new PathTable(L).length).toBe(7);
    expect(new PathTable([L[0], { x: 1, y: 2, z: 2 }]).length).toBe(3);
  });

  it('sample(t) recorre la polilínea por distancia de arco', () => {
    const table = new PathTable(L, 71);
    expect(at(table, 0)).toEqual([0, 0, 0]);
    expect(at(table, 1)).toEqual([3, 4, 0]);
    const corner = at(table, 3 / 7);
    expect(corner[0]).toBeCloseTo(3, 5);
    expect(corner[1]).toBeCloseTo(0, 5);
    const middleOfSecond = at(table, 5 / 7);
    expect(middleOfSecond[0]).toBeCloseTo(3, 5);
    expect(middleOfSecond[1]).toBeCloseTo(2, 5);
    const early = at(table, 1.5 / 7);
    expect(early[0]).toBeCloseTo(1.5, 5);
    expect(early[1]).toBeCloseTo(0, 5);
  });

  it('acota t a [0, 1]', () => {
    const table = new PathTable(L);
    expect(at(table, -3)).toEqual(at(table, 0));
    expect(at(table, 9)).toEqual(at(table, 1));
  });

  it('escribe en el desplazamiento indicado sin tocar el resto', () => {
    const table = new PathTable([L[0], L[1]]);
    const out = new Float32Array([9, 9, 9, 9, 9, 9, 9]);
    table.sample(1, out, 3);
    expect([...out]).toEqual([9, 9, 9, 3, 0, 0, 9]);
  });

  it('remuestrea a distancia uniforme aunque los puntos originales estén mal repartidos', () => {
    const uneven = [
      { x: 0, y: 0, z: 0 },
      { x: 0.1, y: 0, z: 0 },
      { x: 0.2, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    const table = new PathTable(uneven, 101);
    for (const t of [0.1, 0.25, 0.5, 0.9]) expect(at(table, t)[0]).toBeCloseTo(t * 10, 4);
  });

  it('tolera puntos repetidos (tramos de longitud cero)', () => {
    const table = new PathTable([L[0], L[0], L[1], L[1]], 11);
    expect(table.length).toBe(3);
    expect(at(table, 0.5)[0]).toBeCloseTo(1.5, 5);
    const degenerate = new PathTable([L[0], L[0]]);
    expect(degenerate.length).toBe(0);
    expect(at(degenerate, 0.5)).toEqual([0, 0, 0]);
  });
});

describe('pickNode', () => {
  const node = (eventId: string, x: number, y: number, overrides: Partial<Pickable> = {}): Pickable => ({
    eventId,
    x,
    y,
    radius: 10,
    presence: 1,
    inFront: true,
    ...overrides,
  });

  it('devuelve el nodo bajo el puntero o null', () => {
    const nodes = [node('a', 100, 100), node('b', 300, 100)];
    expect(pickNode(nodes, 102, 98)).toBe('a');
    expect(pickNode(nodes, 300, 110)).toBe('b');
    expect(pickNode(nodes, 200, 100)).toBeNull();
    expect(pickNode([], 0, 0)).toBeNull();
  });

  it('usa un radio mínimo generoso (dedos) para nodos pequeños', () => {
    const tiny = [node('a', 100, 100, { radius: 2 })];
    expect(pickNode(tiny, 117, 100)).toBe('a');
    expect(pickNode(tiny, 119, 100)).toBeNull();
    expect(pickNode(tiny, 104, 100, 3)).toBeNull();
  });

  it('el alcance crece con el radio aparente (×1,6)', () => {
    const big = [node('a', 100, 100, { radius: 30 })];
    expect(pickNode(big, 147, 100)).toBe('a');
    expect(pickNode(big, 149, 100)).toBeNull();
  });

  it('ignora nodos atenuados por el filtro o detrás de la cámara', () => {
    expect(pickNode([node('a', 100, 100, { presence: 0.1 })], 100, 100)).toBeNull();
    expect(pickNode([node('a', 100, 100, { inFront: false })], 100, 100)).toBeNull();
    expect(pickNode([node('a', 100, 100, { presence: 0.1 }), node('b', 110, 100)], 100, 100)).toBe('b');
  });

  it('si varios solapan, gana el más cercano en proporción a su alcance', () => {
    const nodes = [node('big', 100, 100, { radius: 40 }), node('small', 130, 100, { radius: 5 })];
    expect(pickNode(nodes, 128, 100)).toBe('small');
    expect(pickNode(nodes, 105, 100)).toBe('big');
  });
});

describe('encuadre: franja libre y extensión vertical', () => {
  it('bandFraction resta las franjas reservadas y nunca baja del mínimo', () => {
    expect(bandFraction(1000, { top: 0, bottom: 0 })).toBe(1);
    expect(bandFraction(1000, { top: 100, bottom: 300 })).toBeCloseTo(0.6, 10);
    expect(bandFraction(1000, { top: 600, bottom: 600 })).toBe(0.35);
    expect(bandFraction(0, { top: 0, bottom: 0 })).toBe(1);
  });

  it('bandOffset: positivo si la franja libre queda por encima del centro, acotado', () => {
    expect(bandOffset(1000, { top: 0, bottom: 0 })).toBe(0);
    expect(bandOffset(1000, { top: 100, bottom: 300 })).toBeCloseTo(0.1, 10);
    expect(bandOffset(1000, { top: 300, bottom: 100 })).toBeCloseTo(-0.1, 10);
    // Abajo tapa casi todo: la franja mínima (35 %) sigue dentro de la ventana.
    expect(bandOffset(1000, { top: 0, bottom: 900 })).toBeCloseTo(0.325, 10);
  });

  it('verticalExtent mira solo los puntos dentro del intervalo de X', () => {
    const branches = [
      { points: [{ x: 0, y: 1, z: 0 }, { x: 10, y: 5, z: 0 }] },
      { points: [{ x: 5, y: -3, z: 0 }, { x: 20, y: -9, z: 0 }] },
    ];
    expect(verticalExtent(branches, 0, 10)).toEqual({ minY: -3, maxY: 5 });
    expect(verticalExtent(branches, 15, 25)).toEqual({ minY: -9, maxY: -9 });
    expect(verticalExtent(branches, 30, 40)).toBeNull();
  });
});

describe('routeAlong (vuelo por una hebra causal)', () => {
  it('remuestrea la polilínea y empieza y acaba en sus extremos', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 2, z: 1 },
      { x: 10, y: 0, z: 0 },
    ];
    const route = routeAlong(points, 4);
    expect(route).toHaveLength(5);
    expect(route[0]).toEqual({ x: 0, y: 0 });
    expect(route[2]).toEqual({ x: 5, y: 2 });
    expect(route[4]).toEqual({ x: 10, y: 0 });
    expect(routeAlong([])).toEqual([]);
    expect(routeAlong([{ x: 1, y: 2, z: 3 }])).toEqual([{ x: 1, y: 2 }]);
  });
});
