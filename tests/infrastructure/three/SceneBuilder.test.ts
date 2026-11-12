import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { BranchCurve } from '../../../src/infrastructure/three/BranchCurve';
import { MergeSeam } from '../../../src/infrastructure/three/MergeSeam';
import { ParticleFlow } from '../../../src/infrastructure/three/ParticleFlow';
import { BRAID_FIBERS, BRAID_STYLE, DEFAULT_PALETTE, SceneBuilder, STRAND_EMPHASIS } from '../../../src/infrastructure/three/SceneBuilder';
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
  it('crea un nodo por evento, en la posición del layout y con el color de SU línea (no de la categoría)', () => {
    const built = new SceneBuilder().build(model);
    expect(built.nodes.map((node) => node.eventId)).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
    // main → color de la categoría de su primer evento (#6EA8FF); side → #B48CFF. b-job es de main.
    expect(built.nodes.map((node) => node.color)).toEqual(['#6EA8FF', '#6EA8FF', '#B48CFF', '#B48CFF']);
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

  it('crea una curva por línea, del color de la línea (el de su primer evento si no declara uno)', () => {
    const built = new SceneBuilder().build(model);
    expect(built.branches.map((branch) => branch.id)).toEqual(['main', 'side']);
    const color = (index: number): string => built.branches[index].mesh.material.uniforms.uColor.value.getHexString();
    expect(`#${color(0)}`).toBe('#6ea8ff');
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

  it('los eventos con duración fuera de la trenza añaden un filamento del color de su línea', () => {
    const built = new SceneBuilder().build(model);
    const spans = built.effects.filter((effect): effect is BranchCurve => effect instanceof BranchCurve && effect.id.startsWith('span:'));
    // a-school y b-job van por la trenza (allí no hacen falta); e-side-two va por su carril.
    expect(spans.map((span) => span.id)).toEqual(['span:e-side-two']);
    expect(spans.map((span) => `#${span.mesh.material.uniforms.uColor.value.getHexString()}`)).toEqual(['#b48cff']);
  });

  it('registra todos los efectos: acuarela, años, ramas, partículas y pulso (nada espacial)', () => {
    const built = new SceneBuilder().build(model);
    expect(count(built.effects, WatercolorWash)).toBe(1);
    expect(built.effects).toContain(built.backdrop);
    expect(count(built.effects, YearMarkers)).toBe(1);
    // 2 líneas + sus fibras (las dos pasan por la trenza: side nace en ella) + 1 tramo.
    expect(count(built.effects, BranchCurve)).toBe(2 + 2 * BRAID_FIBERS.length + 1);
    // Motas de la trenza y motas (pocas) de las ramas exteriores.
    expect(count(built.effects, ParticleFlow)).toBe(2);
    expect(count(built.effects, SelectionPulse)).toBe(1);
    expect(built.effects).toContain(built.pulse);
    for (const branch of built.branches) expect(built.effects).toContain(branch);
  });

  it('la trenza concentra las motas; las ramas exteriores apenas llevan', () => {
    const built = new SceneBuilder().build(model);
    const [braid, outer] = built.effects.filter((effect): effect is ParticleFlow => effect instanceof ParticleFlow);
    expect(braid.count).toBeGreaterThan(outer.count * 10);
    expect(outer.count).toBeLessThanOrEqual(120);
  });

  it('en la trenza las líneas son más gruesas y brillantes y se enroscan; fuera, finas y tenues', () => {
    const built = new SceneBuilder().build(model);
    const side = built.branches[1].mesh;
    const width = side.geometry.getAttribute('aWidth').array as Float32Array;
    const focus = side.geometry.getAttribute('aFocus').array as Float32Array;
    expect(Math.min(...width)).toBeCloseTo(BRAID_STYLE.outerWidth, 2);
    expect(Math.max(...width)).toBeCloseTo(1, 2);
    expect(Math.min(...focus)).toBeCloseTo(BRAID_STYLE.outer, 2);
    expect(side.material.uniforms.uHelix.value.x).toBe(BRAID_STYLE.helix);
    const fiber = built.effects.find((effect): effect is BranchCurve => effect instanceof BranchCurve && effect.id === 'fiber:main:0');
    expect(fiber?.mesh.material.uniforms.uBraidOnly.value).toBe(1);
  });

  it('particleBudget reduce las motas de pigmento (movimiento reducido / móvil)', () => {
    const motes = (budget: number): number =>
      new SceneBuilder({ particleBudget: budget }).build(model).effects.find((effect): effect is ParticleFlow => effect instanceof ParticleFlow)?.count ?? -1;
    expect(motes(0.3)).toBeLessThan(motes(1) * 0.35);
    expect(motes(0.3)).toBeGreaterThan(0);
  });

  it('una hebra causal por enlace, del color de la línea origen al de la destino, con remolino si cambian de línea', () => {
    const data = makeData();
    data.events[0].ledTo = ['b-job', 'c-side'];
    const built = new SceneBuilder().build(buildModel(data));
    expect(built.strands.map((strand) => strand.id)).toEqual(['link:a-school>b-job', 'link:a-school>c-side']);
    for (const strand of built.strands) expect(built.effects).toContain(strand);
    const uniforms = built.strands[1].mesh.material.uniforms;
    expect(uniforms.uColor.value.getHexString()).not.toBe(uniforms.uColorEnd.value.getHexString());
    const swirls = built.effects.filter((effect) => effect instanceof MergeSeam && effect.id.startsWith('swirl:'));
    expect(swirls).toHaveLength(1);
  });

  it('las hebras causales son discretas y se encienden al señalar uno de sus nodos', () => {
    const data = makeData();
    data.events[0].ledTo = ['b-job', 'c-side'];
    const built = new SceneBuilder().build(buildModel(data));
    const settle = (): number[] => {
      for (let i = 0; i < 200; i += 1) for (const strand of built.strands) strand.update(frameContext({ delta: 0.05 }));
      return built.strands.map((strand) => strand.mesh.material.uniforms.uEmphasis.value as number);
    };
    expect(settle()).toEqual([STRAND_EMPHASIS.rest, STRAND_EMPHASIS.rest].map((value) => expect.closeTo(value, 3)));
    built.highlightLinks(['c-side']);
    expect(settle()).toEqual([expect.closeTo(STRAND_EMPHASIS.other, 3), expect.closeTo(STRAND_EMPHASIS.lit, 3)]);
    built.highlightLinks([]);
    built.fadeIn();
    built.strands[0].update(frameContext({ delta: 0.001 }));
    expect(built.strands[0].mesh.material.uniforms.uEmphasis.value).toBeLessThan(0.05);
  });

  it('una chispa por cada unión o separación de la trenza', () => {
    const built = new SceneBuilder().build(model);
    const sparks = built.seams.map((seam) => seam.id);
    expect(sparks).toHaveLength(model.layout.junctions.length);
    for (const id of sparks) expect(id).toMatch(/^(join|split|birth|fray):/);
  });

  it('la paleta y la niebla son configurables (el tronco, para líneas sin color posible)', () => {
    const palette = { ...DEFAULT_PALETTE, trunk: '#123456' };
    const built = new SceneBuilder({ palette, fogDensity: 0.02 }).build(unsafeModel(model, { categories: [] }));
    const uniforms = built.branches[0].mesh.material.uniforms;
    expect(uniforms.uColor.value.getHexString()).toBe('123456');
    expect(uniforms.uFogDensity.value).toBe(0.02);
  });

  it('si una línea no tiene color posible (ni declarado ni de categoría) usa el del tronco', () => {
    const built = new SceneBuilder().build(unsafeModel(model, { categories: [] }));
    expect(new Set(built.nodes.map((node) => node.color))).toEqual(new Set([DEFAULT_PALETTE.trunk]));
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
