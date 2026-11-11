import type { Quaternion} from 'three';
import { Mesh, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GLYPH_FRAGMENT } from '../../../src/infrastructure/three/glyphShader';
import {
  DIMMED_PRESENCE,
  NODE_RADIUS,
  NODE_TIERS,
  NodeAssets,
  NodeMesh,
  STYLE_CODE,
  type NodeSpec,
} from '../../../src/infrastructure/three/NodeMesh';
import { createRingTexture } from '../../../src/infrastructure/three/textures';
import { frameContext } from '../../helpers/three';

const assets = (): NodeAssets => new NodeAssets(createRingTexture(8));

function make(overrides: Partial<NodeSpec> = {}, shared = assets()): NodeMesh {
  return new NodeMesh({ eventId: 'e1', position: { x: 3, y: -2, z: 1 }, color: '#ff0000', importance: 2, phase: 0, ...overrides }, shared);
}

const uniforms = (node: NodeMesh): Record<string, { value: unknown }> => node.glyph.material.uniforms;
const run = (node: NodeMesh, frames: number, overrides = {}): void => {
  for (let i = 0; i < frames; i += 1) node.update(frameContext({ time: i / 60, ...overrides }));
};

describe('NodeMesh: glifo', () => {
  it('se coloca en la posición del layout y se identifica por su evento', () => {
    const node = make();
    expect(node.group.position.toArray()).toEqual([3, -2, 1]);
    expect(node.group.name).toBe('node:e1');
    expect(node.eventId).toBe('e1');
    expect(node.color).toBe('#ff0000');
    expect(node.group.children).toEqual([node.glyph]);
    expect(node.glyph).toBeInstanceOf(Mesh);
  });

  it('el tamaño crece con el peso y el cuadro deja sitio al aura del mayor', () => {
    const sizes = ([1, 2, 3] as const).map((importance) => make({ importance }).glyph.scale.x);
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
    expect(NODE_RADIUS[1]).toBeLessThan(NODE_RADIUS[2]);
    expect(NODE_TIERS[3].extent).toBeGreaterThan(NODE_TIERS[2].extent);
    expect([NODE_TIERS[1].aura, NODE_TIERS[2].aura, NODE_TIERS[3].aura]).toEqual([false, false, true]);
  });

  it('el peso y el lenguaje de forma llegan al shader', () => {
    const node = make({ importance: 3, style: 'organic' });
    expect(uniforms(node).uTier.value).toBe(3);
    expect(uniforms(node).uStyle.value).toBe(STYLE_CODE.organic);
    expect(make({ style: 'geometric' }).style).toBe('geometric');
    expect(make().style).toBe('neutral');
    expect(STYLE_CODE).toEqual({ geometric: 0, organic: 1, neutral: 2 });
  });

  it('el shader define las tres familias de forma y el aura de pigmento', () => {
    for (const fn of ['geometric(', 'organic(', 'neutral(', 'sdHex', 'fwidth', 'uAttention']) expect(GLYPH_FRAGMENT).toContain(fn);
  });

  it('mira siempre a la cámara', () => {
    const node = make();
    const context = frameContext();
    context.camera.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, 0.3);
    node.update(context);
    expect(node.glyph.quaternion.equals(context.camera.quaternion as Quaternion)).toBe(true);
  });

  it('los nodos comparten el cuadro', () => {
    const shared = assets();
    expect(make({}, shared).glyph.geometry).toBe(make({ eventId: 'e2' }, shared).glyph.geometry);
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
    expect(uniforms(node).uPresence.value).toBeGreaterThan(0);
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
    expect(uniforms(node).uTime.value).toBe(0);
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

  it('al señalarlo el pigmento se expande y el glifo crece (más en los menores)', () => {
    const minor = make({ importance: 1 });
    const medium = make({ importance: 2 });
    for (const node of [minor, medium]) {
      run(node, 1);
      node.setHovered(true);
      run(node, 120);
      expect(uniforms(node).uAttention.value).toBeCloseTo(1, 2);
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
  it('dispose saca el nodo de la escena y libera su material (no los recursos compartidos)', () => {
    const shared = assets();
    const node = make({}, shared);
    const scene = new Scene();
    scene.add(node.group);
    const material = vi.spyOn(node.glyph.material, 'dispose');
    const quad = vi.spyOn(shared.quad, 'dispose');
    node.dispose();
    expect(node.group.parent).toBeNull();
    expect(material).toHaveBeenCalled();
    expect(quad).not.toHaveBeenCalled();
  });

  it('NodeAssets.dispose libera el cuadro y la textura', () => {
    const shared = assets();
    const spies = [vi.spyOn(shared.quad, 'dispose'), vi.spyOn(shared.ring, 'dispose')];
    shared.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
