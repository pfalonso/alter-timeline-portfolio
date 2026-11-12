import { Scene, type BufferAttribute } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BranchCurve, type BranchStyle } from '../../../src/infrastructure/three/BranchCurve';
import { PathTable } from '../../../src/infrastructure/three/math';
import { BAND_CLEAR_MIN, ParticleFlow } from '../../../src/infrastructure/three/ParticleFlow';
import { SelectionPulse } from '../../../src/infrastructure/three/SelectionPulse';
import { createRingTexture } from '../../../src/infrastructure/three/textures';
import { YearMarkers } from '../../../src/infrastructure/three/YearMarkers';
import { frameContext } from '../../helpers/three';

const STRAIGHT = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
];

describe('SelectionPulse', () => {
  const make = (): SelectionPulse => new SelectionPulse(createRingTexture(8), 1, 3, 0.2);

  it('en reposo sus anillos son invisibles', () => {
    const pulse = make();
    expect(pulse.rings).toHaveLength(3);
    expect(pulse.isActive).toBe(false);
    for (const ring of pulse.rings) {
      expect(ring.sprite.visible).toBe(false);
      expect(ring.sprite.material.opacity).toBe(0);
    }
  });

  it('trigger lanza los anillos desde el nodo, teñidos con su color', () => {
    const pulse = make();
    pulse.trigger({ x: 4, y: 5, z: 6 }, '#ff0000', 0.5);
    expect(pulse.isActive).toBe(true);
    for (const ring of pulse.rings) {
      expect(ring.sprite.position.toArray()).toEqual([4, 5, 6]);
      expect(ring.sprite.material.color.r).toBeCloseTo(1, 5);
      expect(ring.sprite.material.color.g).toBeGreaterThan(0.05);
      expect(ring.sprite.material.color.g).toBeLessThan(0.5);
    }
  });

  it('cada anillo crece y se apaga; los siguientes salen escalonados', () => {
    const pulse = make();
    pulse.trigger({ x: 0, y: 0, z: 0 }, '#ffffff', 2);
    const [first, second, third] = pulse.rings;

    pulse.update(frameContext({ delta: 0.1 }));
    expect(first.sprite.visible).toBe(true);
    expect(second.sprite.visible).toBe(false); // sale a los 0,2 s
    expect(third.sprite.visible).toBe(false);
    const scale1 = first.sprite.scale.x;
    const opacity1 = first.sprite.material.opacity;
    expect(scale1).toBeGreaterThan(2 * 3);
    expect(opacity1).toBeCloseTo(0.81 * 0.9, 5);

    pulse.update(frameContext({ delta: 0.25 }));
    expect(first.sprite.scale.x).toBeGreaterThan(scale1);
    expect(first.sprite.material.opacity).toBeLessThan(opacity1);
    expect(second.sprite.visible).toBe(true);
    expect(second.sprite.scale.x).toBeLessThan(first.sprite.scale.x);
    expect(third.sprite.visible).toBe(false);
  });

  it('termina y se oculta al cumplirse la duración (más el escalonado)', () => {
    const pulse = make();
    pulse.trigger({ x: 0, y: 0, z: 0 }, '#ffffff', 1);
    pulse.update(frameContext({ delta: 0.5 }));
    pulse.update(frameContext({ delta: 0.55 }));
    expect(pulse.rings[0].sprite.visible).toBe(false);
    expect(pulse.rings[1].sprite.visible).toBe(true);
    expect(pulse.isActive).toBe(true);
    pulse.update(frameContext({ delta: 0.5 }));
    expect(pulse.isActive).toBe(false);
    expect(pulse.rings.every((ring) => !ring.sprite.visible)).toBe(true);
  });

  it('se puede volver a lanzar a mitad de animación', () => {
    const pulse = make();
    pulse.trigger({ x: 0, y: 0, z: 0 }, '#ffffff', 1);
    pulse.update(frameContext({ delta: 0.6 }));
    pulse.trigger({ x: 9, y: 0, z: 0 }, '#ffffff', 1);
    pulse.update(frameContext({ delta: 0.1 }));
    expect(pulse.rings[0].sprite.position.x).toBe(9);
    expect(pulse.rings[0].sprite.material.opacity).toBeCloseTo(0.81 * 0.9, 5);
  });

  it('con movimiento reducido no hay onda', () => {
    const pulse = make();
    pulse.trigger({ x: 0, y: 0, z: 0 }, '#ffffff', 1);
    pulse.update(frameContext({ delta: 0.1, reducedMotion: true }));
    expect(pulse.isActive).toBe(false);
    expect(pulse.rings.every((ring) => !ring.sprite.visible)).toBe(true);
  });

  it('attach / dispose', () => {
    const pulse = make();
    const scene = new Scene();
    pulse.attach(scene);
    expect(scene.children).toHaveLength(3);
    const dispose = vi.spyOn(pulse.rings[0].sprite.material, 'dispose');
    pulse.dispose();
    expect(scene.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('valores por defecto: tres anillos', () => {
    expect(new SelectionPulse(createRingTexture(8)).rings).toHaveLength(3);
  });
});

describe('ParticleFlow', () => {
  const path = (): { path: PathTable; color: string } => ({ path: new PathTable(STRAIGHT, 11), color: '#00ff00' });
  /** Rama por su carril (fuera de la banda de nodos, donde las motas se apagan). */
  const LANE_Y = 5;
  const lanePath = (): { path: PathTable; color: string } => ({
    path: new PathTable(STRAIGHT.map((point) => ({ ...point, y: LANE_Y })), 11),
    color: '#00ff00',
  });
  const xs = (flow: ParticleFlow): number[] => {
    const position = flow.points.geometry.attributes.position.array;
    return Array.from({ length: flow.count }, (_, i) => position[i * 3]);
  };

  it('el nº de partículas es proporcional a la longitud de las ramas, con un máximo', () => {
    expect(new ParticleFlow([path()], { density: 2 }).count).toBe(20);
    expect(new ParticleFlow([path(), path()], { density: 2 }).count).toBe(40);
    expect(new ParticleFlow([path()], { density: 100, maxParticles: 50 }).count).toBe(50);
    expect(new ParticleFlow([]).count).toBe(0);
  });

  it('reparte el presupuesto entre ramas según su longitud', () => {
    const long = { path: new PathTable([STRAIGHT[0], { x: 30, y: 0, z: 0 }]), color: '#ff0000' };
    const flow = new ParticleFlow([path(), long], { density: 1 });
    const colors = flow.points.geometry.attributes.aColor.array;
    let green = 0;
    for (let i = 0; i < flow.count; i += 1) if (colors[i * 3 + 1] > colors[i * 3]) green += 1;
    expect(flow.count).toBe(40);
    expect(green).toBe(10);
  });

  it('es determinista por semilla', () => {
    const a = new ParticleFlow([path()], { seed: 3 });
    const b = new ParticleFlow([path()], { seed: 3 });
    const c = new ParticleFlow([path()], { seed: 4 });
    expect(xs(a)).toEqual(xs(b));
    expect(xs(a)).not.toEqual(xs(c));
  });

  it('las partículas nacen sobre la rama, a poca distancia de su eje', () => {
    const flow = new ParticleFlow([path()], { density: 5 });
    const position = flow.points.geometry.attributes.position.array;
    for (let i = 0; i < flow.count; i += 1) {
      expect(position[i * 3]).toBeGreaterThanOrEqual(0);
      expect(position[i * 3]).toBeLessThanOrEqual(10);
      expect(Math.hypot(position[i * 3 + 1], position[i * 3 + 2])).toBeLessThan(0.9);
    }
  });

  it('avanzan hacia el futuro (X creciente) y al llegar al final vuelven a empezar', () => {
    const flow = new ParticleFlow([path()], { density: 5, speed: 1 });
    const before = xs(flow);
    flow.update(frameContext({ delta: 0.1, time: 0.1 }));
    const after = xs(flow);
    const advanced = after.filter((x, i) => x > before[i]).length;
    const wrapped = after.filter((x, i) => x < before[i]).length;
    expect(advanced + wrapped).toBe(flow.count);
    expect(advanced).toBeGreaterThan(flow.count * 0.9);
    // Tras mucho tiempo siguen todas dentro de la rama.
    for (let i = 0; i < 200; i += 1) flow.update(frameContext({ delta: 0.1, time: i }));
    for (const x of xs(flow)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
    }
  });

  it('en una rama que se disuelve, al final las motas se dispersan, suben y se apagan', () => {
    const flow = new ParticleFlow([{ ...lanePath(), dissolve: 0.3 }], { density: 60 });
    const position = flow.points.geometry.attributes.position.array;
    const alpha = flow.points.geometry.attributes.aAlpha.array;
    let maxSpread = 0;
    for (let i = 0; i < flow.count; i += 1) {
      const x = position[i * 3];
      const spread = Math.hypot(position[i * 3 + 1] - LANE_Y, position[i * 3 + 2]);
      // Antes de la zona de disolución se comportan como siempre.
      if (x < 6.5) expect(spread).toBeLessThan(0.9);
      if (x > 9) maxSpread = Math.max(maxSpread, spread);
      if (x > 9.95) expect(alpha[i]).toBeLessThan(0.05);
      if (x > 7.2 && x < 8) expect(alpha[i]).toBeGreaterThan(0.7);
    }
    expect(maxSpread).toBeGreaterThan(1.2);
  });

  it('las motas frenan en la zona de disolución', () => {
    const normal = new ParticleFlow([path()], { density: 30, speed: 1 });
    const dissolving = new ParticleFlow([{ ...path(), dissolve: 0.5 }], { density: 30, speed: 1 });
    const start = xs(normal);
    normal.update(frameContext({ delta: 0.05, time: 0 }));
    dissolving.update(frameContext({ delta: 0.05, time: 0 }));
    const moved = (flow: ParticleFlow): number =>
      xs(flow).reduce((sum, x, i) => (start[i] > 6 && start[i] < 9 ? sum + Math.max(0, x - start[i]) : sum), 0);
    expect(moved(dissolving)).toBeLessThan(moved(normal));
  });

  it('en la banda de los nodos (y ≈ 0) casi se apagan: no ensucian los símbolos', () => {
    const band = new ParticleFlow([path()], { density: 40 });
    const lane = new ParticleFlow([lanePath()], { density: 40 });
    const max = (flow: ParticleFlow): number => Math.max(...flow.points.geometry.attributes.aAlpha.array);
    expect(max(band)).toBeLessThan(0.5);
    expect(BAND_CLEAR_MIN).toBeLessThan(0.2);
    expect(max(lane)).toBe(1);
  });

  it('la trenza: sin limpiar la banda, órbita escalable, sin motas donde el foco es 0 y reparto por foco', () => {
    const max = (flow: ParticleFlow): number => Math.max(...flow.points.geometry.attributes.aAlpha.array);
    const braid = new ParticleFlow([path()], { density: 40, clearBand: false });
    expect(max(braid)).toBeGreaterThan(0.9);
    const spread = (flow: ParticleFlow): number => {
      const position = flow.points.geometry.attributes.position.array;
      return Math.max(...Array.from({ length: flow.count }, (_, i) => Math.abs(position[i * 3 + 1])));
    };
    expect(spread(new ParticleFlow([lanePath()], { density: 40, orbitScale: 0.3 }))).toBeLessThan(
      spread(new ParticleFlow([lanePath()], { density: 40 })),
    );
    const off = new Float32Array(16);
    const on = new Float32Array(16).fill(1);
    const silent = new ParticleFlow([{ ...lanePath(), focus: off }], { density: 40, floor: 0 });
    const lit = Array.from(silent.points.geometry.attributes.aAlpha.array).filter((alpha) => alpha > 0.01).length;
    expect(lit / silent.count).toBeLessThan(0.1);
    const weighted = new ParticleFlow([{ ...path(), focus: on }, { ...path(), focus: off }], { density: 4, weighted: true });
    expect(weighted.count).toBe(40);
    expect(new ParticleFlow([{ ...path(), focus: on }, { ...path(), focus: off }], { density: 4 }).count).toBe(80);
  });

  it('se desvanecen en los extremos de la rama', () => {
    const flow = new ParticleFlow([lanePath()], { density: 40 });
    const alpha = flow.points.geometry.attributes.aAlpha.array;
    const x = xs(flow);
    for (let i = 0; i < flow.count; i += 1) {
      expect(alpha[i]).toBeGreaterThanOrEqual(0);
      expect(alpha[i]).toBeLessThanOrEqual(1);
      if (x[i] > 1 && x[i] < 8.5) expect(alpha[i]).toBe(1);
      if (x[i] > 9.95) expect(alpha[i]).toBeLessThan(0.1);
    }
  });

  it('con movimiento reducido casi no se mueven', () => {
    const normal = new ParticleFlow([path()], { density: 5 });
    const reduced = new ParticleFlow([path()], { density: 5 });
    const start = xs(normal);
    normal.update(frameContext({ delta: 0.05, time: 0 }));
    reduced.update(frameContext({ delta: 0.05, time: 0, reducedMotion: true }));
    const moved = (flow: ParticleFlow): number => xs(flow).reduce((sum, x, i) => sum + Math.max(0, x - start[i]), 0);
    expect(moved(reduced)).toBeGreaterThan(0);
    expect(moved(reduced)).toBeLessThan(moved(normal) * 0.2);
  });

  it('el tamaño de punto sigue al alto del viewport y marca los búferes como sucios', () => {
    const flow = new ParticleFlow([path()]);
    const position = flow.points.geometry.attributes.position as BufferAttribute;
    const versionBefore = position.version;
    flow.update(frameContext({ viewport: { width: 500, height: 1000 } }));
    expect(flow.points.material.uniforms.uScale.value).toBe(900);
    expect(position.version).toBeGreaterThan(versionBefore);
  });

  it('attach / dispose', () => {
    const flow = new ParticleFlow([path()]);
    const scene = new Scene();
    flow.attach(scene);
    expect(scene.getObjectByName('particle-flow')).toBe(flow.points);
    const geometry = vi.spyOn(flow.points.geometry, 'dispose');
    const material = vi.spyOn(flow.points.material, 'dispose');
    flow.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });
});

describe('BranchCurve', () => {
  const style: BranchStyle = { color: '#3366ff', radius: 0.1, intensity: 0.8, fadeIn: 0.05, fadeOut: 0.3, flowSpeed: 0.2, fogDensity: 0.01 };
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 3, y: 4, z: 0 },
  ];

  it('construye un tubo con nombre y expone la trayectoria para las partículas', () => {
    const curve = new BranchCurve('side', points, style);
    expect(curve.id).toBe('side');
    expect(curve.mesh.name).toBe('branch:side');
    expect(curve.path.length).toBe(7);
    expect(curve.mesh.geometry.attributes.position.count).toBeGreaterThan(0);
  });

  it('pasa el estilo al material', () => {
    const { uniforms } = new BranchCurve('side', points, style).mesh.material;
    expect(uniforms.uColor.value.getHexString()).toBe('3366ff');
    expect(uniforms.uLength.value).toBe(7);
    expect(uniforms.uIntensity.value).toBe(0.8);
    expect(uniforms.uFadeIn.value).toBe(0.05);
    expect(uniforms.uFadeOut.value).toBe(0.3);
    expect(uniforms.uFlowSpeed.value).toBe(0.2);
    expect(uniforms.uFogDensity.value).toBe(0.01);
  });

  it('trenza: hélice y pertenencia por anillo del tubo; las fibras solo existen dentro', () => {
    const helix = { radius: 0.2, phase: 1, frequency: 0.5, speed: 0.3 };
    const curve = new BranchCurve('b', points, { ...style, braid: [1, 1, 0], helix, braidOnly: true });
    const { uniforms } = curve.mesh.material;
    expect(uniforms.uHelix.value.toArray()).toEqual([0.2, 1, 0.5, 0.3]);
    expect(uniforms.uBraidOnly.value).toBe(1);
    const braid = curve.mesh.geometry.getAttribute('aBraid').array as Float32Array;
    expect(Math.max(...braid)).toBe(1);
    expect(Math.min(...braid)).toBe(0);
    const plain = new BranchCurve('p', points, style).mesh;
    expect(Math.max(...(plain.geometry.getAttribute('aBraid').array as Float32Array))).toBe(0);
    expect(plain.material.uniforms.uBraidOnly.value).toBe(0);
  });

  it('fadeIn nunca es 0 (evita smoothstep(0, 0, x) en el shader)', () => {
    const { uniforms } = new BranchCurve('x', points, { ...style, fadeIn: 0 }).mesh.material;
    expect(uniforms.uFadeIn.value).toBeGreaterThan(0);
  });

  it('la energía fluye con el tiempo; con movimiento reducido se congela', () => {
    const curve = new BranchCurve('x', points, style);
    curve.update(frameContext({ time: 3.5 }));
    expect(curve.mesh.material.uniforms.uTime.value).toBe(3.5);
    curve.update(frameContext({ time: 9, reducedMotion: true }));
    expect(curve.mesh.material.uniforms.uTime.value).toBe(0);
  });

  it('attach / dispose', () => {
    const curve = new BranchCurve('x', points, style);
    const scene = new Scene();
    curve.attach(scene);
    expect(scene.children).toEqual([curve.mesh]);
    const geometry = vi.spyOn(curve.mesh.geometry, 'dispose');
    const material = vi.spyOn(curve.mesh.material, 'dispose');
    curve.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });

  it('con menos de dos puntos falla de forma explícita', () => {
    expect(() => new BranchCurve('x', [points[0]], style)).toThrow(/dos puntos/);
  });
});

describe('YearMarkers', () => {
  const years = [
    { year: 2010, x: 0 },
    { year: 2011, x: 5 },
    { year: 2012, x: 10 },
  ];
  const bounds = { minX: -6, maxX: 53, minY: -1, maxY: 5 };

  it('traza un meridiano vertical por año que cruza todos los carriles con margen', () => {
    const markers = new YearMarkers(years, bounds);
    const position = markers.lines.geometry.attributes.position;
    expect(markers.lines.name).toBe('year-markers');
    expect(position.count).toBe(6);
    expect([...position.array]).toEqual([0, -10, -1.5, 0, 14, -1.5, 5, -10, -1.5, 5, 14, -1.5, 10, -10, -1.5, 10, 14, -1.5]);
  });

  it('son tenues y admiten otro color', () => {
    const markers = new YearMarkers(years, bounds, '#ff0000');
    expect(markers.lines.material.opacity).toBeLessThan(0.2);
    expect(markers.lines.material.transparent).toBe(true);
    expect(markers.lines.material.color.getHexString()).toBe('ff0000');
  });

  it('sin años no hay líneas', () => {
    expect(new YearMarkers([], bounds).lines.geometry.attributes.position.count).toBe(0);
  });

  it('es estático: update no cambia nada; attach / dispose', () => {
    const markers = new YearMarkers(years, bounds);
    const before = [...markers.lines.geometry.attributes.position.array];
    markers.update();
    expect([...markers.lines.geometry.attributes.position.array]).toEqual(before);
    const scene = new Scene();
    markers.attach(scene);
    expect(scene.children).toEqual([markers.lines]);
    const material = vi.spyOn(markers.lines.material, 'dispose');
    markers.dispose();
    expect(scene.children).toHaveLength(0);
    expect(material).toHaveBeenCalledTimes(1);
  });
});
