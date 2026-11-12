import { Scene, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { FOCUS_OUT } from '../../../src/domain/services';
import { BranchCurve } from '../../../src/infrastructure/three/BranchCurve';
import { PathTable, readTable, sampleAlongPath, valueAtX } from '../../../src/infrastructure/three/math';
import { DEFAULT_SEAM_OPTIONS, MergeSeam } from '../../../src/infrastructure/three/MergeSeam';
import { ParticleFlow } from '../../../src/infrastructure/three/ParticleFlow';
import { DEFAULT_PALETTE, SceneBuilder } from '../../../src/infrastructure/three/SceneBuilder';
import { buildModel, makeLifeLinesData } from '../../helpers/fixtures';
import { frameContext } from '../../helpers/three';

const line = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 20, y: 0, z: 0 },
];
const style = { color: '#ff0000', radius: 0.1, intensity: 1, fadeIn: 0.02, fadeOut: 0, flowSpeed: 0.1, fogDensity: 0.01 };

describe('math: valores por punto a lo largo de una curva', () => {
  it('valueAtX interpola por X y satura en los extremos; sin valores, 1', () => {
    expect(valueAtX(line, [0, 1, 0.5], 5)).toBeCloseTo(0.5);
    expect(valueAtX(line, [0, 1, 0.5], 15)).toBeCloseTo(0.75);
    expect(valueAtX(line, [0, 1, 0.5], -3)).toBe(0);
    expect(valueAtX(line, [0, 1, 0.5], 99)).toBe(0.5);
    expect(valueAtX(line, undefined, 5)).toBe(1);
    expect(valueAtX([], [1], 5)).toBe(1);
    expect(valueAtX([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], [0.2, 0.8], 0)).toBe(0.2);
  });

  it('sampleAlongPath + readTable: tabla uniforme en t', () => {
    const table = sampleAlongPath(new PathTable(line, 21), line, [0, 1, 0], 5);
    expect([...table].map((value) => Math.round(value * 100) / 100)).toEqual([0, 0.5, 1, 0.5, 0]);
    expect(readTable(table, 0.125)).toBeCloseTo(0.25);
    expect(readTable(table, 2)).toBe(0);
    expect(readTable(undefined, 0.5)).toBe(1);
    expect(readTable(new Float32Array([0.4]), 0.9)).toBeCloseTo(0.4);
  });
});

describe('BranchCurve con foco', () => {
  it('lleva un valor de foco y de grosor por vértice, leídos en la X de cada anillo', () => {
    const curve = new BranchCurve('b', line, { ...style, focus: [0.3, 1, 0.3], widths: [1, 2, 1] });
    const focus = curve.mesh.geometry.getAttribute('aFocus') as BufferAttribute;
    const width = curve.mesh.geometry.getAttribute('aWidth') as BufferAttribute;
    expect(focus.count).toBe(curve.mesh.geometry.getAttribute('position').count);
    const values = [...(focus.array as Float32Array)];
    expect(Math.min(...values)).toBeCloseTo(0.3);
    expect(Math.max(...values)).toBeCloseTo(1, 1);
    expect(Math.max(...(width.array as Float32Array))).toBeCloseTo(2, 1);
  });

  it('sin foco, todo a 1 (comportamiento clásico)', () => {
    const curve = new BranchCurve('b', line, style);
    expect([...(curve.mesh.geometry.getAttribute('aFocus').array as Float32Array)].every((v) => v === 1)).toBe(true);
  });

  it('setEmphasis transiciona con suavidad; con movimiento reducido es inmediato; aplica la niebla del fotograma', () => {
    const curve = new BranchCurve('b', line, style);
    curve.setEmphasis('on');
    curve.update(frameContext({ delta: 0.05 }));
    expect(curve.currentEmphasis).toBeGreaterThan(1);
    expect(curve.currentEmphasis).toBeLessThan(1.7);
    curve.setEmphasis('off');
    curve.update(frameContext({ reducedMotion: true, fogDensity: 0.002 }));
    expect(curve.currentEmphasis).toBeCloseTo(0.28);
    expect(curve.mesh.material.uniforms.uFogDensity.value).toBe(0.002);
    curve.dispose();
  });
});

describe('ParticleFlow con foco y resalte', () => {
  const path = new PathTable(line, 40);
  const visible = (flow: ParticleFlow): number =>
    [...(flow.points.geometry.getAttribute('aAlpha').array as Float32Array)].filter((alpha) => alpha > 0.05).length;

  it('fuera de foco hay menos motas visibles y más tenues', () => {
    const focused = new ParticleFlow([{ path, color: '#fff' }], { density: 20, maxParticles: 400 });
    const dim = new ParticleFlow([{ path, color: '#fff', focus: new Float32Array([FOCUS_OUT, FOCUS_OUT]) }], {
      density: 20,
      maxParticles: 400,
    });
    expect(dim.count).toBe(focused.count);
    expect(visible(dim)).toBeLessThan(visible(focused) * 0.75);
  });

  it('highlight resalta las motas de una línea y atenúa las demás', () => {
    const flow = new ParticleFlow(
      [
        { id: 'a', path, color: '#fff' },
        { id: 'b', path, color: '#fff' },
      ],
      { density: 4 },
    );
    flow.highlight('a');
    flow.update(frameContext({ reducedMotion: true }));
    expect(flow.emphasisLevels[0]).toBeGreaterThan(1);
    expect(flow.emphasisLevels[1]).toBeLessThan(1);
    flow.highlight(null);
    flow.update(frameContext({ delta: 10 }));
    expect(flow.emphasisLevels.map((value) => Math.round(value * 100) / 100)).toEqual([1, 1]);
  });
});

describe('MergeSeam', () => {
  it('con core 0 (remolino de una hebra causal) no hay destello central blanco', () => {
    const swirl = new MergeSeam('s', { x: 0, y: 0, z: 0 }, '#ff0000', '#0000ff', { count: 10, radius: 0.8, core: 0 });
    const sizes = swirl.points.geometry.getAttribute('aSize').array as Float32Array;
    const colors = swirl.points.geometry.getAttribute('aColor').array as Float32Array;
    expect(sizes[0]).toBe(0);
    expect(colors[0]).toBeLessThan(1);
    const flash = new MergeSeam('f', { x: 0, y: 0, z: 0 }, '#ff0000', '#0000ff', { count: 10 });
    expect((flash.points.geometry.getAttribute('aSize').array as Float32Array)[0]).toBeCloseTo(DEFAULT_SEAM_OPTIONS.core, 5);
  });

  it('es un destello y un remolino de motas alrededor del punto de fusión que late con el tiempo', () => {
    const seam = new MergeSeam('art', { x: 5, y: 2, z: -1 }, '#ff0000', '#0000ff', { count: 20, radius: 1.5 });
    const scene = new Scene();
    seam.attach(scene);
    expect(scene.getObjectByName('merge-seam:art')).toBe(seam.points);
    const positions = seam.points.geometry.getAttribute('position').array as Float32Array;
    expect([...positions.slice(0, 3)]).toEqual([5, 2, -1]);
    for (let i = 0; i < positions.length; i += 3) {
      expect(Math.hypot(positions[i] - 5, positions[i + 1] - 2, positions[i + 2] + 1)).toBeLessThan(2.5);
    }
    const before = [...positions];
    seam.update(frameContext({ time: 1.3 }));
    expect([...positions]).not.toEqual(before);
    // Con movimiento reducido se queda quieto.
    seam.update(frameContext({ time: 5, reducedMotion: true }));
    const still = [...positions];
    seam.update(frameContext({ time: 9, reducedMotion: true }));
    expect([...positions]).toEqual(still);
    seam.dispose();
    expect(scene.getObjectByName('merge-seam:art')).toBeUndefined();
  });
});

describe('SceneBuilder con líneas vitales', () => {
  const model = buildModel(makeLifeLinesData());

  it('una costura por cada fusión y una chispa por cada unión o separación de la trenza', () => {
    const built = new SceneBuilder().build(model);
    expect(built.seams.filter((seam) => !/^(join|split):/.test(seam.id)).map((seam) => seam.id)).toEqual(['art']);
    expect(built.seams).toHaveLength(model.layout.junctions.length);
    for (const seam of built.seams) expect(built.effects).toContain(seam);
    built.dispose();
  });

  it('usa el color declarado de cada línea; sin él, el de su primer evento (también la central)', () => {
    const built = new SceneBuilder().build(model);
    const color = (id: string): string =>
      `#${built.branches.find((curve) => curve.id === id)?.mesh.material.uniforms.uColor.value.getHexString()}`;
    expect(color('food')).toBe('#7be0a4');
    expect(color('core')).toBe('#ffb454');
    expect(DEFAULT_PALETTE.trunk).toMatch(/^#/);
    // Los nodos llevan el color de su línea.
    const food = built.nodes.find((node) => node.eventId === 'bread');
    expect(food?.color).toBe('#7BE0A4');
    built.dispose();
  });

  it('la central engorda al entrar en la trenza (en foco hoy) respecto a su carril', () => {
    const built = new SceneBuilder().build(model);
    const core = built.branches.find((curve) => curve.id === 'core');
    const widths = [...(core?.mesh.geometry.getAttribute('aWidth').array as Float32Array)];
    expect(widths[widths.length - 1]).toBeGreaterThan(Math.min(...widths) * 1.5);
    built.dispose();
  });

  it('highlightBranch resalta una línea y atenúa las demás; null las restablece', () => {
    const built = new SceneBuilder().build(model);
    built.highlightBranch('food');
    for (const curve of built.branches) curve.update(frameContext({ reducedMotion: true }));
    const emphasis = Object.fromEntries(built.branches.map((curve) => [curve.id, curve.currentEmphasis]));
    expect(emphasis.food).toBeGreaterThan(1);
    expect(emphasis.core).toBeLessThan(1);
    built.highlightBranch(null);
    for (const curve of built.branches) curve.update(frameContext({ reducedMotion: true }));
    expect(built.branches.every((curve) => curve.currentEmphasis === 1)).toBe(true);
    built.dispose();
  });
});
