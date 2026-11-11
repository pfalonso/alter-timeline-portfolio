import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { ARC_OPACITY, ArcBands, activeArcAt } from '../../../src/infrastructure/three/ArcBands';
import { CameraRig } from '../../../src/infrastructure/three/CameraRig';
import { easeInOutCubic, pointOnRoute, storyRoute, yOnLine } from '../../../src/infrastructure/three/math';
import { buildModel, makeStoryData } from '../../helpers/fixtures';
import { frameContext } from '../../helpers/three';

const line = (y0: number, y1: number, x0 = 0, x1 = 10) => [
  { x: x0, y: y0, z: 0 },
  { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 0 },
  { x: x1, y: y1, z: 0 },
];

describe('ruta del vuelo del modo historia', () => {
  it('yOnLine interpola dentro de la línea y devuelve null fuera', () => {
    expect(yOnLine(line(0, 10), 5)).toBe(5);
    expect(yOnLine(line(0, 10), 2.5)).toBe(2.5);
    expect(yOnLine(line(0, 10), -1)).toBeNull();
    expect(yOnLine(line(0, 10), 11)).toBeNull();
    expect(yOnLine(undefined, 3)).toBeNull();
    expect(yOnLine([{ x: 1, y: 4, z: 0 }, { x: 1, y: 6, z: 0 }], 1)).toBe(4);
  });

  it('empieza y acaba en los nodos y, por el camino, sigue la línea de salida y luego la de llegada', () => {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 10, y: 6, z: 0 };
    // Línea de salida plana en y = 0; línea de llegada plana en y = 6.
    const route = storyRoute(from, to, line(0, 0, -5, 15), line(6, 6, -5, 15), 20);
    expect(route).toHaveLength(21);
    expect(route[0]).toEqual({ x: 0, y: 0 });
    expect(route[20]).toEqual({ x: 10, y: 6 });
    expect(route[2].y).toBeLessThan(0.2); // al principio, pegada a la línea de salida
    expect(route[18].y).toBeGreaterThan(5.8); // al final, a la de llegada
    expect(route.every((point, i) => i === 0 || point.x > route[i - 1].x)).toBe(true); // avanza por el tiempo
    // Sin líneas: recta entre ambos nodos.
    expect(storyRoute(from, to, undefined, undefined, 2)[1]).toEqual({ x: 5, y: 3 });
  });

  it('pointOnRoute y easeInOutCubic', () => {
    const route = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(pointOnRoute(route, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnRoute(route, 0.25)).toEqual({ x: 5, y: 0 });
    expect(pointOnRoute(route, 1)).toEqual({ x: 10, y: 10 });
    expect(pointOnRoute(route, 7)).toEqual({ x: 10, y: 10 });
    expect(pointOnRoute([], 0.5)).toEqual({ x: 0, y: 0 });
    expect(pointOnRoute([{ x: 3, y: 4 }], 0.5)).toEqual({ x: 3, y: 4 });
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
  });
});

describe('CameraRig.flyAlong', () => {
  const rig = (): CameraRig => {
    const camera = new PerspectiveCamera(38, 2, 0.5, 1600);
    const r = new CameraRig(camera);
    r.snap();
    return r;
  };
  const route = [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 20, y: 0 }];

  it('recorre la ruta en el tiempo indicado y termina en su último punto', () => {
    const r = rig();
    r.flyAlong(route, 20, 1, 10);
    expect(r.flying).toBe(true);
    expect(r.target).toMatchObject({ x: 20, y: 0, distance: 20 });
    r.update(0.5);
    expect(r.lookX).toBeCloseTo(10, 5);
    expect(r.distance).toBeGreaterThan(20); // se aleja a mitad de vuelo
    for (let i = 0; i < 10; i += 1) r.update(0.1);
    expect(r.flying).toBe(false);
    expect(r.lookX).toBeCloseTo(20, 5);
  });

  it('un gesto, otro vuelo o el movimiento reducido cortan el vuelo', () => {
    const r = rig();
    r.flyAlong(route, 20, 1);
    r.panByPixels(10, 0, 800);
    expect(r.flying).toBe(false);
    r.flyAlong(route, 20, 1);
    r.zoomBy(0.9);
    expect(r.flying).toBe(false);
    r.flyAlong(route, 20, 1);
    r.flyTo({ x: 3, y: 3 });
    expect(r.flying).toBe(false);
    r.flyAlong(route, 20, 1);
    r.update(0.016, true);
    expect(r.flying).toBe(false);
    expect(r.lookX).toBeCloseTo(20, 5); // corte directo al final
    r.flyAlong(route, 20, 1);
    r.snap();
    expect(r.flying).toBe(false);
  });

  it('rutas degeneradas: vacía no hace nada; un punto o duración 0 es un flyTo', () => {
    const r = rig();
    r.flyAlong([], 20, 1);
    expect(r.flying).toBe(false);
    r.flyAlong([{ x: 7, y: 1 }], 20, 1);
    expect(r.flying).toBe(false);
    expect(r.target).toMatchObject({ x: 7, y: 1 });
    r.flyAlong(route, 20, 0);
    expect(r.flying).toBe(false);
    expect(r.target.x).toBe(20);
  });
});

describe('ArcBands', () => {
  const layout = buildModel(makeStoryData()).layout;

  it('activeArcAt devuelve el capítulo que contiene la X', () => {
    expect(activeArcAt(layout.arcs, layout.arcs[0].startX + 0.1)).toBe('aprender');
    expect(activeArcAt(layout.arcs, layout.arcs[2].startX)).toBe('desvio');
    expect(activeArcAt(layout.arcs, layout.arcs[0].startX - 1)).toBeNull();
    expect(activeArcAt([], 0)).toBeNull();
  });

  it('un velo y un separador por arco; el activo se ilumina (al instante con movimiento reducido)', () => {
    const bands = new ArcBands(layout.arcs, layout.bounds);
    const scene = new Scene();
    bands.attach(scene);
    expect(scene.children).toHaveLength(6);
    bands.update(frameContext({ reducedMotion: true }));
    expect(bands.bands.every((band) => !band.veil.visible)).toBe(true);
    expect(bands.bands[0].edge.material.opacity).toBeCloseTo(ARC_OPACITY.edge.idle, 6);
    bands.setActive('oficio');
    expect(bands.active).toBe('oficio');
    bands.update(frameContext({ reducedMotion: true }));
    expect(bands.bands[1].veil.visible).toBe(true);
    expect(bands.bands[1].veil.material.opacity).toBeCloseTo(ARC_OPACITY.veil.active, 6);
    expect(bands.bands[1].edge.material.opacity).toBeCloseTo(ARC_OPACITY.edge.active, 6);
    bands.setActive(null);
    bands.update(frameContext({ delta: 0.016 }));
    expect(bands.bands[1].edge.material.opacity).toBeGreaterThan(ARC_OPACITY.edge.idle);
    expect(bands.bands[1].edge.material.opacity).toBeLessThan(ARC_OPACITY.edge.active);
    // El velo se difumina en vertical y en los bordes: hay vértices con alfa 0.
    const alpha = bands.bands[1].veil.geometry.getAttribute('color');
    expect(alpha.itemSize).toBe(4);
    expect(Math.min(...Array.from({ length: alpha.count }, (_, i) => alpha.getW(i)))).toBe(0);
    bands.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
