import type { Quaternion } from 'three';
import { LineSegments, Mesh, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { LineStyle } from '../../../src/domain/model';
import {
  DIMMED_PRESENCE,
  NODE_RADIUS,
  NODE_TIERS,
  NodeAssets,
  NodeMesh,
  type NodeSpec,
} from '../../../src/infrastructure/three/NodeMesh';
import { createNodeShape, deformSphere, mergeSegments, ringGeometry } from '../../../src/infrastructure/three/NodeShapes';
import { createRingTexture } from '../../../src/infrastructure/three/textures';
import { IcosahedronGeometry } from 'three';
import { frameContext } from '../../helpers/three';

const assets = (): NodeAssets => new NodeAssets(createRingTexture(8));

function make(overrides: Partial<NodeSpec> = {}, shared = assets()): NodeMesh {
  return new NodeMesh({ eventId: 'e1', position: { x: 3, y: -2, z: 1 }, color: '#ff0000', importance: 2, phase: 0, ...overrides }, shared);
}

const run = (node: NodeMesh, frames: number, overrides = {}): void => {
  for (let i = 0; i < frames; i += 1) node.update(frameContext({ time: i / 60, delta: 1 / 60, ...overrides }));
};
const segments = (style: LineStyle, importance: 1 | 2 | 3): number => {
  const shape = createNodeShape(style, importance);
  return shape.wire.getAttribute('position').count / 2 + (shape.inner ? shape.inner.getAttribute('position').count / 2 : 0);
};

describe('NodeMesh: sólido 3D en wireframe', () => {
  it('se coloca en la posición del layout y se identifica por su evento', () => {
    const node = make();
    expect(node.group.position.toArray()).toEqual([3, -2, 1]);
    expect(node.group.name).toBe('node:e1');
    expect(node.eventId).toBe('e1');
    expect(node.color).toBe('#ff0000');
    expect(node.group.children).toEqual([node.aura, node.spinner]);
    expect(node.wire).toBeInstanceOf(LineSegments);
    expect(node.fill).toBeInstanceOf(Mesh);
  });

  it('aristas, relleno y aura llevan el color de su línea (el relleno, papel apenas teñido)', () => {
    const node = make({ color: '#00ff00' });
    expect(node.wire.material.color.g).toBeGreaterThan(0.9);
    expect(node.aura.material.uniforms.uColor.value.getHexString()).toBe('00ff00');
    const fill = node.fill.material.color;
    expect(fill.g).toBeGreaterThan(fill.r);
    expect(fill.g).toBeLessThan(0.4);
  });

  it('el tamaño crece con el peso y solo el mayor tiene aura en reposo', () => {
    const sizes = ([1, 2, 3] as const).map((importance) => make({ importance }).spinner.scale.x);
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
    expect(NODE_RADIUS[1]).toBeLessThan(NODE_RADIUS[2]);
    expect([NODE_TIERS[1].aura, NODE_TIERS[2].aura, NODE_TIERS[3].aura]).toEqual([false, false, true]);
    expect(make({ importance: 3 }).aura.material.uniforms.uStrength.value).toBeGreaterThan(0);
    expect(make({ importance: 1 }).aura.material.uniforms.uStrength.value).toBe(0);
  });

  it('cada lenguaje tiene su familia de formas y el peso se distingue por complejidad', () => {
    expect(make({ style: 'geometric' }).style).toBe('geometric');
    expect(make().style).toBe('neutral');
    for (const style of ['geometric', 'organic', 'neutral'] as const) {
      expect(segments(style, 1)).toBeLessThan(segments(style, 3));
    }
    // Geométrico: tetraedro (6 aristas), octaedro (12), icosaedro (30) + cubo inscrito (12).
    expect([segments('geometric', 1), segments('geometric', 2), segments('geometric', 3)]).toEqual([6, 12, 42]);
    expect(createNodeShape('geometric', 3).inner).not.toBeNull();
    expect(createNodeShape('neutral', 3).inner).not.toBeNull();
    expect(createNodeShape('organic', 2).inner).toBeNull();
  });

  it('las piezas de las formas: anillos, uniones y esfera deformada sin abrirse', () => {
    const ring = ringGeometry(2, 8, Math.PI / 2, Math.PI / 2);
    const p = ring.getAttribute('position');
    expect(p.count).toBe(16);
    for (let i = 0; i < p.count; i += 1) expect(Math.hypot(p.getX(i), p.getY(i), p.getZ(i))).toBeCloseTo(2, 5);
    expect(mergeSegments([ringGeometry(1, 4), ringGeometry(1, 6)]).getAttribute('position').count).toBe(20);
    const sphere = deformSphere(new IcosahedronGeometry(1, 1), 0.2, 1);
    const q = sphere.getAttribute('position');
    const radii = new Set<string>();
    for (let i = 0; i < q.count; i += 1) radii.add(Math.hypot(q.getX(i), q.getY(i), q.getZ(i)).toFixed(2));
    expect(radii.size).toBeGreaterThan(3);
  });

  it('gira despacio sobre sí mismo; quieto con movimiento reducido', () => {
    const node = make({ importance: 3, style: 'geometric' });
    const y0 = node.spinner.rotation.y;
    const x0 = node.inner?.rotation.x ?? 0;
    run(node, 60);
    expect(node.spinner.rotation.y).toBeGreaterThan(y0);
    expect(node.spinner.rotation.y - y0).toBeLessThan(1);
    expect(node.inner?.rotation.x).toBeLessThan(x0);
    const still = make();
    const r = still.spinner.rotation.y;
    run(still, 60, { reducedMotion: true });
    expect(still.spinner.rotation.y).toBe(r);
  });

  it('el aura mira siempre a la cámara', () => {
    const node = make();
    const context = frameContext();
    context.camera.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, 0.3);
    node.update(context);
    expect(node.aura.quaternion.equals(context.camera.quaternion as Quaternion)).toBe(true);
  });

  it('los nodos del mismo estilo y peso comparten geometrías', () => {
    const shared = assets();
    const a = make({ style: 'organic', importance: 3 }, shared);
    const b = make({ eventId: 'e2', style: 'organic', importance: 3 }, shared);
    expect(a.wire.geometry).toBe(b.wire.geometry);
    expect(a.aura.geometry).toBe(shared.quad);
    expect(make({ style: 'organic', importance: 1 }, shared).wire.geometry).not.toBe(a.wire.geometry);
  });
});

describe('NodeMesh: filtro (presencia)', () => {
  it('empieza plenamente visible', () => {
    expect(make().presence).toBe(1);
  });

  it('al filtrarse se atenúa con una transición, sin desaparecer del todo', () => {
    const node = make();
    node.setVisible(false);
    run(node, 3);
    expect(node.presence).toBeLessThan(1);
    expect(node.presence).toBeGreaterThan(DIMMED_PRESENCE);
    run(node, 300);
    expect(node.presence).toBeCloseTo(DIMMED_PRESENCE, 2);
    expect(node.wire.material.opacity).toBeGreaterThan(0);
    expect(node.wire.material.opacity).toBeLessThan(0.3);
    node.setVisible(true);
    run(node, 300);
    expect(node.presence).toBeCloseTo(1, 2);
  });

  it('setVisible inmediato y movimiento reducido no interpolan', () => {
    const node = make();
    node.setVisible(false, true);
    expect(node.presence).toBe(DIMMED_PRESENCE);
    node.setVisible(true);
    node.setHovered(true);
    node.update(frameContext({ reducedMotion: true, time: 5 }));
    expect(node.presence).toBe(1);
    expect(node.attention).toBe(1);
  });
});

describe('NodeMesh: hover y foco', () => {
  it('highlighted refleja hover o foco', () => {
    const node = make();
    expect(node.highlighted).toBe(false);
    node.setHovered(true);
    expect(node.highlighted).toBe(true);
    node.setHovered(false);
    node.setFocused(true);
    expect(node.highlighted).toBe(true);
  });

  it('al señalarlo se expande y brilla (sin sobreexponer); crece más en los menores', () => {
    const minor = make({ importance: 1 });
    const medium = make({ importance: 2 });
    for (const node of [minor, medium]) {
      run(node, 1);
      const rest = node.wire.material.opacity;
      node.setHovered(true);
      run(node, 120);
      expect(node.attention).toBeCloseTo(1, 2);
      expect(node.wire.material.opacity).toBeGreaterThan(rest);
      expect(node.wire.material.opacity).toBeLessThanOrEqual(1);
      expect(node.aura.material.uniforms.uStrength.value).toBeGreaterThan(0.25);
    }
    expect(minor.scale).toBeGreaterThan(medium.scale);
    expect(medium.scale).toBeGreaterThan(1.1);
  });

  it('el foco también expande el pigmento', () => {
    const node = make();
    node.setFocused(true);
    run(node, 120);
    expect(node.attention).toBeCloseTo(1, 2);
  });

  it('respira con el tiempo, desfasado por nodo', () => {
    const a = make({ phase: 0 });
    const b = make({ phase: 2 });
    a.update(frameContext({ time: 1 }));
    b.update(frameContext({ time: 1 }));
    expect(a.scale).not.toBeCloseTo(b.scale, 5);
  });
});

describe('NodeMesh / NodeAssets: liberación', () => {
  it('dispose saca el nodo de la escena y libera sus materiales (no los recursos compartidos)', () => {
    const shared = assets();
    const node = make({ importance: 3, style: 'geometric' }, shared);
    const scene = new Scene();
    scene.add(node.group);
    const material = vi.spyOn(node.wire.material, 'dispose');
    const inner = vi.spyOn(node.inner?.material as never as { dispose(): void }, 'dispose');
    const quad = vi.spyOn(shared.quad, 'dispose');
    node.dispose();
    expect(node.group.parent).toBeNull();
    expect(material).toHaveBeenCalled();
    expect(inner).toHaveBeenCalled();
    expect(quad).not.toHaveBeenCalled();
  });

  it('NodeAssets.dispose libera el cuadro, la textura y las formas creadas', () => {
    const shared = assets();
    const shape = shared.shape('neutral', 3);
    const spies = [vi.spyOn(shared.quad, 'dispose'), vi.spyOn(shared.ring, 'dispose'), vi.spyOn(shape.wire, 'dispose'), vi.spyOn(shape.fill, 'dispose')];
    shared.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
