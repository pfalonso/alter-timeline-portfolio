import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { BranchCurve } from '../../../src/infrastructure/three/BranchCurve';
import { ParticleFlow } from '../../../src/infrastructure/three/ParticleFlow';
import { bandFade, DEFAULT_PALETTE, SceneBuilder } from '../../../src/infrastructure/three/SceneBuilder';
import { SelectionPulse } from '../../../src/infrastructure/three/SelectionPulse';
import { WatercolorWash } from '../../../src/infrastructure/three/Watercolor';
import { YearMarkers } from '../../../src/infrastructure/three/YearMarkers';
import { unsafeModel } from '../../helpers/dom';
import { buildModel, makeData } from '../../helpers/fixtures';
import { frameContext } from '../../helpers/three';

const model = buildModel();
const count = <T>(items: readonly unknown[], type: new (...args: never[]) => T): number =>
  items.filter((item) => item instanceof type).length;

describe('SceneBuilder', () => {
  it('crea un nodo por evento, en la posición del layout y con el color de su categoría principal', () => {
    const built = new SceneBuilder().build(model);
    expect(built.nodes.map((node) => node.eventId)).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
    expect(built.nodes.map((node) => node.color)).toEqual(['#6EA8FF', '#FFB454', '#B48CFF', '#B48CFF']);
    expect(built.nodes.map((node) => node.importance)).toEqual([2, 3, 1, 2]);
    built.nodes.forEach((node, index) => {
      const { x, y, z } = model.layout.nodes[index].position;
      expect(node.group.position.x).toBeCloseTo(x, 5);
      expect(node.group.position.y).toBeCloseTo(y, 5);
      expect(node.group.position.z).toBeCloseTo(z, 5);
    });
  });

  it('la forma de cada nodo sale del estilo de su línea (por defecto según el id)', () => {
    const built = new SceneBuilder().build(model);
    expect(built.nodes.map((node) => node.style)).toEqual(
      model.layout.nodes.map((node) => model.timeline.lineStyleOf(node.branch)),
    );
  });

  it('crea una curva por rama: el tronco pálido, cada bifurcación con el color de su primer evento', () => {
    const built = new SceneBuilder().build(model);
    expect(built.branches.map((branch) => branch.id)).toEqual(['main', 'side']);
    const color = (index: number): string => built.branches[index].mesh.material.uniforms.uColor.value.getHexString();
    expect(`#${color(0)}`).toBe(DEFAULT_PALETTE.trunk);
    expect(`#${color(1)}`).toBe('#b48cff');
    // Una rama cerrada se desvanece al final; el tronco apenas.
    expect(built.branches[1].mesh.material.uniforms.uFadeOut.value).toBeGreaterThan(
      built.branches[0].mesh.material.uniforms.uFadeOut.value,
    );
  });

  it('una rama abierta (con un evento en curso) no se desvanece como una cerrada', () => {
    const data = makeData();
    data.events[4].date = { start: '2018-01-15', end: 'present' };
    const open = new SceneBuilder().build(buildModel(data)).branches[1].mesh.material.uniforms.uFadeOut.value;
    const closed = new SceneBuilder().build(model).branches[1].mesh.material.uniforms.uFadeOut.value;
    expect(open).toBeLessThan(closed);
  });

  it('los eventos con duración añaden un filamento del color de su categoría', () => {
    const built = new SceneBuilder().build(model);
    const spans = built.effects.filter((effect): effect is BranchCurve => effect instanceof BranchCurve && effect.id.startsWith('span:'));
    expect(spans.map((span) => span.id)).toEqual(['span:a-school', 'span:b-job', 'span:e-side-two']);
    expect(spans.map((span) => `#${span.mesh.material.uniforms.uColor.value.getHexString()}`)).toEqual(['#6ea8ff', '#ffb454', '#b48cff']);
  });

  it('registra todos los efectos: acuarela, años, ramas, partículas y pulso (nada espacial)', () => {
    const built = new SceneBuilder().build(model);
    expect(count(built.effects, WatercolorWash)).toBe(1);
    expect(built.effects).toContain(built.backdrop);
    expect(count(built.effects, YearMarkers)).toBe(1);
    expect(count(built.effects, BranchCurve)).toBe(2 + 3);
    expect(count(built.effects, ParticleFlow)).toBe(1);
    expect(count(built.effects, SelectionPulse)).toBe(1);
    expect(built.effects).toContain(built.pulse);
    for (const branch of built.branches) expect(built.effects).toContain(branch);
  });

  it('las partículas recorren las ramas (no los tramos de duración)', () => {
    const built = new SceneBuilder().build(model);
    const flow = built.effects.find((effect): effect is ParticleFlow => effect instanceof ParticleFlow);
    const total = built.branches.reduce((sum, branch) => sum + branch.path.length, 0);
    expect(flow?.count).toBe(Math.round(total * 2.6));
  });

  it('particleBudget reduce las motas de pigmento (movimiento reducido / móvil)', () => {
    const motes = (budget: number): number =>
      new SceneBuilder({ particleBudget: budget }).build(model).effects.find((effect): effect is ParticleFlow => effect instanceof ParticleFlow)?.count ?? -1;
    expect(motes(0.3)).toBeLessThan(motes(1) * 0.35);
    expect(motes(0.3)).toBeGreaterThan(0);
  });

  it('las líneas se desvanecen un poco fuera de la banda de nodos', () => {
    expect(bandFade(0)).toBe(1);
    expect(bandFade(1)).toBe(1);
    expect(bandFade(10)).toBeCloseTo(0.55, 5);
    expect(bandFade(-4)).toBeLessThan(1);
  });

  it('la paleta y la niebla son configurables', () => {
    const palette = { ...DEFAULT_PALETTE, trunk: '#123456' };
    const built = new SceneBuilder({ palette, fogDensity: 0.02 }).build(model);
    const uniforms = built.branches[0].mesh.material.uniforms;
    expect(uniforms.uColor.value.getHexString()).toBe('123456');
    expect(uniforms.uFogDensity.value).toBe(0.02);
  });

  it('si falta la categoría de un evento usa el color de reserva', () => {
    const built = new SceneBuilder().build(unsafeModel(model, { categories: [] }));
    expect(new Set(built.nodes.map((node) => node.color))).toEqual(new Set([DEFAULT_PALETTE.fallbackNode]));
  });

  it('funciona con una línea temporal vacía (solo el tronco)', () => {
    const data = makeData();
    data.events = [];
    const built = new SceneBuilder().build(buildModel(data));
    expect(built.nodes).toEqual([]);
    expect(built.branches.map((branch) => branch.id)).toEqual(['main']);
  });

  it('todos los efectos se pueden adjuntar, actualizar y liberar sin WebGL', () => {
    const built = new SceneBuilder({ particleBudget: 0.2 }).build(model);
    const scene = new Scene();
    for (const effect of built.effects) effect.attach(scene);
    for (const node of built.nodes) scene.add(node.group);
    expect(scene.getObjectByName('branch:side')).toBeDefined();
    expect(scene.getObjectByName('node:b-job')).toBeDefined();
    const populated = scene.children.length;
    expect(populated).toBeGreaterThanOrEqual(built.effects.length + built.nodes.length);

    const context = frameContext({ time: 1 });
    expect(() => {
      for (const effect of built.effects) effect.update(context);
      for (const node of built.nodes) node.update(context);
    }).not.toThrow();

    built.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
