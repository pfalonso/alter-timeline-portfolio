import type { Mesh, MeshBasicMaterial} from 'three';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { ActiveTip } from '../../../src/infrastructure/three/ActiveTip';
import { heartbeat, NODE_RADIUS, NodeAssets, NodeMesh, UNION_RING } from '../../../src/infrastructure/three/NodeMesh';
import { BIG_UNION_SCALE, SceneBuilder } from '../../../src/infrastructure/three/SceneBuilder';
import { createRingTexture } from '../../../src/infrastructure/three/textures';
import { buildModel } from '../../helpers/fixtures';
import { frameContext } from '../../helpers/three';
import { makeUnionData } from '../../helpers/unionFixtures';

const NOW = new Date(Date.UTC(2020, 0, 1));
const model = buildModel(makeUnionData(), { now: NOW });

describe('NodeMesh: encrucijada y latido', () => {
  const make = (extra: Partial<ConstructorParameters<typeof NodeMesh>[0]> = {}): NodeMesh =>
    new NodeMesh({ eventId: 'n', position: { x: 0, y: 0, z: 0 }, color: '#ff0000', importance: 2, phase: 0, ...extra }, new NodeAssets(createRingTexture(8)));

  it('un anillo con un segmento por color, más grande que el sólido', () => {
    const node = make({ ringColors: ['#ff0000', '#00ff00', '#0000ff'] });
    expect(node.ring?.children).toHaveLength(3);
    expect(node.lineCount).toBe(3);
    const colors = node.ring?.children.map((child) => ((child as Mesh).material as MeshBasicMaterial).color.getHexString());
    expect(new Set(colors).size).toBe(3);
    node.dispose();
    expect(make().ring).toBeNull();
  });

  it('el multiplicador de tamaño agranda el nodo', () => {
    expect(make({ scale: 1.5 }).radius).toBeCloseTo(NODE_RADIUS[2] * 1.5, 9);
  });

  it('el anillo mira a la cámara; un activo late (aura y anillo) salvo con movimiento reducido', () => {
    const node = make({ active: true, ringColors: ['#ff0000'] });
    const strength = (time: number, reducedMotion = false): number => {
      node.update(frameContext({ time, delta: 1 / 60, reducedMotion }));
      return node.aura.material.uniforms.uStrength.value as number;
    };
    const peak = strength(0.24);
    const rest = strength(1.6);
    expect(peak).toBeGreaterThan(rest);
    expect(strength(0.24, true)).toBeCloseTo(strength(1.6, true), 9);
    const opacity = ((node.ring?.children[0] as Mesh).material as MeshBasicMaterial).opacity;
    expect(opacity).toBeGreaterThan(UNION_RING.opacity * 0.5);
  });

  it('heartbeat: dos golpes por periodo, acotado en [0, 1]', () => {
    const values = Array.from({ length: 240 }, (_, i) => heartbeat(i / 100));
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(heartbeat(0.24)).toBeGreaterThan(0.9);
    expect(heartbeat(1.5)).toBeLessThan(0.05);
  });
});

describe('ActiveTip', () => {
  const path = [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ];
  it('la punta avanza hacia el final y con movimiento reducido queda fija en el extremo', () => {
    const tip = new ActiveTip('a', path, '#55aaff');
    const scene = new Scene();
    tip.attach(scene);
    expect(scene.children).toContain(tip.points);
    const headX = (time: number, reducedMotion = false): number => {
      tip.update(frameContext({ time, reducedMotion }));
      return tip.points.geometry.getAttribute('position').getX(1);
    };
    expect(headX(2)).toBeGreaterThan(headX(1));
    expect(headX(1, true)).toBeCloseTo(10, 3);
    // La plumilla (mota 0) siempre en el extremo.
    expect(tip.points.geometry.getAttribute('position').getX(0)).toBeCloseTo(10, 3);
    tip.dispose();
    expect(scene.children).not.toContain(tip.points);
  });
});

describe('SceneBuilder: uniones, pausas, caminos que no fueron y activos', () => {
  const built = new SceneBuilder().build(model);

  it('una línea en pausa se dibuja en dos tramos; el primero se disuelve', () => {
    const ids = built.branches.map((curve) => curve.id);
    expect(ids).toEqual(expect.arrayContaining(['tech', 'tech#1', 'arte', 'arte#1', 'cocina', 'cocina#1', 'vida']));
    expect(ids).not.toContain('vida#1');
  });

  it('caminos que no fueron, chispas de nacimiento/deshilachado y puntas de activos', () => {
    expect(built.ghosts.map((curve) => curve.id)).toEqual(['ghost:derecho', 'ghost:arquitectura']);
    const seams = built.seams.map((seam) => seam.id);
    expect(seams.some((id) => id.startsWith('fray:tech@'))).toBe(true);
    expect(seams.some((id) => id.startsWith('birth:cocina@'))).toBe(true);
    expect(built.actives.map((tip) => tip.id)).toEqual(['e-tech2']);
    for (const item of [...built.ghosts, ...built.actives]) expect(built.effects).toContain(item);
  });

  it('nodos de unión con anillo multicolor; los de ≥ 4 líneas, más grandes; el activo con anillo propio', () => {
    const byId = new Map(built.nodes.map((node) => [node.eventId, node]));
    expect(byId.get('e-cross')?.ring?.children).toHaveLength(3);
    expect(byId.get('e-accident')?.ring?.children).toHaveLength(4);
    expect(byId.get('e-accident')?.radius).toBeCloseTo(NODE_RADIUS[2] * BIG_UNION_SCALE, 9);
    expect(byId.get('e-tech2')?.active).toBe(true);
    expect(byId.get('e-tech2')?.ring?.children).toHaveLength(1);
    expect(byId.get('e-art2')?.ring).toBeNull();
  });

  it('resaltar una línea alcanza todos sus tramos y fadeIn incluye los ghosts', () => {
    built.highlightBranch('tech');
    built.fadeIn();
    built.highlightBranch(null);
    built.dispose();
  });
});
