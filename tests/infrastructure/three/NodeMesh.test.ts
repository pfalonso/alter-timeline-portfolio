import { Group, LineSegments, Mesh, Scene, Sprite, type MeshBasicMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DIMMED_PRESENCE, NODE_RADIUS, NodeAssets, NodeMesh, type NodeSpec } from '../../../src/infrastructure/three/NodeMesh';
import { createGlowTexture, createRingTexture } from '../../../src/infrastructure/three/textures';
import { frameContext } from '../../helpers/three';

const assets = (): NodeAssets => new NodeAssets(createGlowTexture(8), createRingTexture(8));

function make(overrides: Partial<NodeSpec> = {}): NodeMesh {
  return new NodeMesh(
    { eventId: 'e1', position: { x: 3, y: -2, z: 1 }, color: '#ff0000', secondaryColors: [], importance: 2, phase: 0, ...overrides },
    assets(),
  );
}

/** Piezas del nodo, por su posición en el grupo: halo, anillo y cuerpo (núcleo, jaula, satélites). */
function parts(node: NodeMesh): { halo: Sprite; ring: Sprite; body: Group; core: Mesh; shell: LineSegments; satellites: Mesh[] } {
  const [halo, ring, body] = node.group.children as [Sprite, Sprite, Group];
  const [core, shell, ...satellites] = body.children as [Mesh, LineSegments, ...Mesh[]];
  return { halo, ring, body, core, shell, satellites };
}

const run = (node: NodeMesh, frames: number, overrides = {}): void => {
  for (let i = 0; i < frames; i += 1) node.update(frameContext({ time: i / 60, ...overrides }));
};

describe('NodeMesh: construcción', () => {
  it('se coloca en la posición del layout y se identifica por su evento', () => {
    const node = make();
    expect(node.group.position.toArray()).toEqual([3, -2, 1]);
    expect(node.group.name).toBe('node:e1');
    expect(node.eventId).toBe('e1');
    expect(node.color).toBe('#ff0000');
  });

  it('el radio crece con la importancia', () => {
    expect([1, 2, 3].map((importance) => make({ importance: importance as 1 | 2 | 3 }).radius)).toEqual([
      NODE_RADIUS[1], NODE_RADIUS[2], NODE_RADIUS[3],
    ]);
    expect(NODE_RADIUS[1]).toBeLessThan(NODE_RADIUS[2]);
    expect(NODE_RADIUS[2]).toBeLessThan(NODE_RADIUS[3]);
    const { core } = parts(make({ importance: 3 }));
    expect(core.scale.x).toBe(NODE_RADIUS[3]);
  });

  it('se compone de halo, anillo y cuerpo (núcleo + jaula)', () => {
    const { halo, ring, body, core, shell, satellites } = parts(make());
    expect(halo).toBeInstanceOf(Sprite);
    expect(ring).toBeInstanceOf(Sprite);
    expect(body).toBeInstanceOf(Group);
    expect(core).toBeInstanceOf(Mesh);
    expect(shell).toBeInstanceOf(LineSegments);
    expect(satellites).toEqual([]);
  });

  it('el núcleo lleva el color de la categoría aclarado; un satélite por categoría secundaria', () => {
    const { core, satellites, halo } = parts(make({ secondaryColors: ['#00ff00', '#0000ff'] }));
    const coreColor = (core.material as MeshBasicMaterial).color;
    expect(coreColor.r).toBeCloseTo(1, 5);
    expect(coreColor.g).toBeGreaterThan(0);
    expect(coreColor.g).toBeLessThan(0.3);
    expect(halo.material.color.getHexString()).toBe('ff0000');
    expect(satellites).toHaveLength(2);
    expect((satellites[0].material as MeshBasicMaterial).color.g).toBeCloseTo(1, 5);
    expect((satellites[1].material as MeshBasicMaterial).color.b).toBeCloseTo(1, 5);
    // En órbita alrededor del núcleo, no sobre él.
    for (const satellite of satellites) expect(satellite.position.length()).toBeCloseTo(NODE_RADIUS[2] * 2.7, 5);
  });

  it('los nodos comparten geometrías y texturas', () => {
    const shared = assets();
    const spec: NodeSpec = { eventId: 'a', position: { x: 0, y: 0, z: 0 }, color: '#ffffff', secondaryColors: [], importance: 1, phase: 0 };
    const a = parts(new NodeMesh(spec, shared));
    const b = parts(new NodeMesh({ ...spec, eventId: 'b' }, shared));
    expect(a.core.geometry).toBe(b.core.geometry);
    expect(a.halo.material.map).toBe(b.halo.material.map);
    expect(a.core.material).not.toBe(b.core.material);
  });

  it('solo los nodos de importancia 3 muestran anillo en reposo', () => {
    expect(parts(make({ importance: 3 })).ring.material.opacity).toBeCloseTo(0.3, 5);
    expect(parts(make({ importance: 2 })).ring.material.opacity).toBe(0);
  });
});

describe('NodeMesh: filtro (presencia)', () => {
  it('empieza plenamente visible', () => {
    const node = make();
    expect(node.presence).toBe(1);
    expect((parts(node).core.material as MeshBasicMaterial).opacity).toBe(1);
  });

  it('al filtrarse se atenúa con una transición, sin desaparecer del todo', () => {
    const node = make();
    node.setVisible(false);
    expect(node.presence).toBe(1); // aún no ha pasado ningún fotograma
    node.update(frameContext());
    const afterOne = node.presence;
    expect(afterOne).toBeLessThan(1);
    expect(afterOne).toBeGreaterThan(0.8);
    run(node, 300);
    expect(node.presence).toBeCloseTo(DIMMED_PRESENCE, 4);
    const { core, shell, body } = parts(node);
    expect((core.material as MeshBasicMaterial).opacity).toBeGreaterThan(0.15);
    expect((core.material as MeshBasicMaterial).opacity).toBeLessThan(0.3);
    expect((shell.material as MeshBasicMaterial).opacity).toBeLessThan(0.02);
    expect(body.scale.x).toBeCloseTo(0.64, 2);
  });

  it('vuelve a aparecer al quitar el filtro', () => {
    const node = make();
    node.setVisible(false, true);
    expect(node.presence).toBe(DIMMED_PRESENCE);
    node.setVisible(true);
    run(node, 300);
    expect(node.presence).toBeCloseTo(1, 4);
  });

  it('con movimiento reducido el cambio es inmediato y sin latido ni rotación', () => {
    const node = make();
    node.setVisible(false);
    node.setFocused(true);
    node.update(frameContext({ reducedMotion: true, time: 123 }));
    expect(node.presence).toBe(DIMMED_PRESENCE);
    expect(node.scale).toBeCloseTo((0.6 + 0.4 * DIMMED_PRESENCE) * 1.16, 6);
    expect(parts(node).shell.rotation.x).toBe(0);
  });

  it('los satélites se atenúan con el nodo', () => {
    const node = make({ secondaryColors: ['#00ff00'] });
    node.setVisible(false, true);
    node.update(frameContext());
    expect((parts(node).satellites[0].material as MeshBasicMaterial).opacity).toBeCloseTo(DIMMED_PRESENCE, 2);
  });
});

describe('NodeMesh: hover, foco y animación', () => {
  it('highlighted refleja hover o foco', () => {
    const node = make();
    expect(node.highlighted).toBe(false);
    node.setHovered(true);
    expect(node.highlighted).toBe(true);
    node.setHovered(false);
    node.setFocused(true);
    expect(node.highlighted).toBe(true);
    node.setFocused(false);
    expect(node.highlighted).toBe(false);
  });

  it('el hover agranda el cuerpo y el halo y enciende el anillo', () => {
    const node = make();
    const { halo, ring } = parts(node);
    const haloBefore = halo.scale.x;
    node.setHovered(true);
    run(node, 120, { time: 0 });
    expect(node.scale).toBeCloseTo(1.22, 3);
    expect(halo.scale.x).toBeGreaterThan(haloBefore * 1.2);
    expect(ring.material.opacity).toBeCloseTo(0.35, 2);
    node.setHovered(false);
    run(node, 120, { time: 0 });
    expect(node.scale).toBeCloseTo(1, 3);
  });

  it('el foco enciende el anillo con más fuerza y agranda el nodo', () => {
    const node = make();
    node.setFocused(true);
    run(node, 240, { time: 0 });
    expect(node.scale).toBeCloseTo(1.16, 3);
    expect(parts(node).ring.material.opacity).toBeCloseTo(0.85, 2);
  });

  it('el halo late y la jaula gira con el tiempo', () => {
    const node = make();
    node.update(frameContext({ time: 0 }));
    const { halo, shell } = parts(node);
    const atRest = halo.scale.x;
    node.update(frameContext({ time: Math.PI / 2 / 1.25 })); // cresta del latido
    expect(halo.scale.x).toBeCloseTo(atRest * 1.1, 4);
    expect(shell.rotation.x).toBeGreaterThan(0);
    expect(shell.rotation.y).toBeGreaterThan(shell.rotation.x);
  });

  it('la fase desincroniza el latido entre nodos', () => {
    const a = make({ phase: 0 });
    const b = make({ phase: Math.PI / 2 });
    a.update(frameContext({ time: 0 }));
    b.update(frameContext({ time: 0 }));
    expect(parts(b).halo.scale.x).toBeGreaterThan(parts(a).halo.scale.x);
  });

  it('de cerca el halo se contiene para no quemar la imagen', () => {
    const near = make();
    const far = make();
    const camera = frameContext().camera;
    camera.position.set(3, -2, 11); // a 10 unidades del nodo
    near.update(frameContext({ camera }));
    const farCamera = frameContext().camera;
    farCamera.position.set(3, -2, 101);
    far.update(frameContext({ camera: farCamera }));
    expect(parts(near).halo.material.opacity).toBeCloseTo(parts(far).halo.material.opacity / 2, 5);
  });

  it('los satélites orbitan', () => {
    const node = make({ secondaryColors: ['#00ff00'] });
    node.update(frameContext({ time: 0 }));
    const before = parts(node).satellites[0].position.clone();
    node.update(frameContext({ time: 1 }));
    expect(parts(node).satellites[0].position.distanceTo(before)).toBeGreaterThan(0.1);
  });
});

describe('NodeMesh / NodeAssets: liberación', () => {
  it('dispose saca el nodo de la escena y libera sus materiales (no los recursos compartidos)', () => {
    const shared = assets();
    const node = new NodeMesh(
      { eventId: 'e', position: { x: 0, y: 0, z: 0 }, color: '#ffffff', secondaryColors: ['#ff00ff'], importance: 2, phase: 0 },
      shared,
    );
    const scene = new Scene();
    scene.add(node.group);
    const { core, shell, halo, ring, satellites } = parts(node);
    const spies = [core.material, shell.material, halo.material, ring.material, satellites[0].material].map((material) =>
      vi.spyOn(material as MeshBasicMaterial, 'dispose'),
    );
    const sharedGeometry = vi.spyOn(shared.core, 'dispose');

    node.dispose();

    expect(scene.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(sharedGeometry).not.toHaveBeenCalled();
  });

  it('NodeAssets.dispose libera geometrías y texturas', () => {
    const shared = assets();
    const spies = [shared.core, shared.shell, shared.satellite, shared.glow, shared.ring].map((resource) =>
      vi.spyOn(resource as { dispose(): void }, 'dispose'),
    );
    shared.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
