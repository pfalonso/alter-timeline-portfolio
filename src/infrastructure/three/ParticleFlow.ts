import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type Scene,
} from 'three';
import { createRandom, damp, readTable, smoothstep, type PathTable } from './math';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

export interface FlowPath {
  /** Id de la línea (para resaltarla desde la leyenda). */
  readonly id?: string;
  readonly path: PathTable;
  readonly color: string;
  /**
   * Foco a lo largo de la rama (tabla uniforme en t, ver `sampleAlongPath`): fuera de foco hay
   * menos motas visibles, más lentas y más tenues. Sin tabla, foco pleno.
   */
  readonly focus?: Float32Array;
  /**
   * Fracción final de la rama en la que las motas se dispersan y se apagan, como si la rama se
   * deshiciera en polvo (ramas que no llegan al presente). 0 o ausente = final normal.
   */
  readonly dissolve?: number;
}

/** Cuánto se separan del eje, como máximo, las motas que se disuelven (multiplica su órbita). */
export const DISSOLVE_SPREAD = 6;
/** Cuánto ascienden las motas al final de una rama que se disuelve (unidades de mundo). */
export const DISSOLVE_RISE = 1.4;

export interface ParticleFlowOptions {
  /** Partículas por unidad de longitud de rama. */
  readonly density: number;
  readonly maxParticles: number;
  /** Unidades de mundo por segundo. */
  readonly speed: number;
  readonly seed: number;
}

/** Opacidad mínima de las motas dentro de la banda de nodos. */
export const BAND_CLEAR_MIN = 0.12;

export const DEFAULT_FLOW_OPTIONS: ParticleFlowOptions = { density: 2.6, maxParticles: 2400, speed: 2.4, seed: 7 };

export const POINTS_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vAlpha = aAlpha;
    vColor = aColor;
    gl_PointSize = max(1.0, aSize * uScale / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

/** Motas de pigmento: disco irregular con el borde algo más cargado (como una gota que se seca). */
export const POINTS_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float wobble = 0.08 * sin(atan(c.y, c.x) * 3.0 + vColor.r * 17.0);
    float d = length(c) * 2.0 + wobble;
    float body = 1.0 - smoothstep(0.7, 1.0, d);
    float rim = smoothstep(0.35, 0.85, d) * body;
    gl_FragColor = vec4(vColor, (0.3 * body + 0.3 * rim) * vAlpha);
  }
`;

interface Particle {
  readonly pathIndex: number;
  /** Umbral de densidad: la mota solo se ve donde la densidad local lo supera. */
  readonly rank: number;
  t: number;
  readonly speed: number;
  readonly angle: number;
  readonly spin: number;
  readonly orbit: number;
}

/**
 * Motas de energía que recorren las ramas hacia el futuro (un solo `Points`). En las ramas que
 * terminan (`dissolve`) las motas se dispersan, suben y se apagan: una vida que no siguió.
 */
export class ParticleFlow implements SceneEffect {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly count: number;
  private readonly particles: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly options: ParticleFlowOptions;
  private readonly emphasis: number[];
  private readonly emphasisTarget: number[];

  constructor(
    private readonly paths: readonly FlowPath[],
    options: Partial<ParticleFlowOptions> = {},
  ) {
    this.options = { ...DEFAULT_FLOW_OPTIONS, ...options };
    this.emphasis = paths.map(() => 1);
    this.emphasisTarget = paths.map(() => 1);
    const random = createRandom(this.options.seed);
    const totalLength = paths.reduce((sum, item) => sum + item.path.length, 0);
    const budget = Math.min(this.options.maxParticles, Math.round(totalLength * this.options.density));
    const colors: number[] = [];
    const sizes: number[] = [];
    const white = new Color('#ffffff');
    paths.forEach((item, pathIndex) => {
      const share = totalLength > 0 ? Math.round((budget * item.path.length) / totalLength) : 0;
      const base = new Color(item.color);
      for (let i = 0; i < share; i += 1) {
        const bright = random() < 0.18;
        this.particles.push({
          pathIndex,
          rank: random(),
          t: random(),
          speed: (0.55 + random() * 0.9) * (bright ? 1.6 : 1),
          angle: random() * Math.PI * 2,
          spin: (random() - 0.5) * 1.4,
          orbit: bright ? 0.05 + random() * 0.12 : 0.12 + Math.pow(random(), 2) * 0.75,
        });
        // Pigmento, no chispa: las motas conservan el color de su línea (apenas se aclaran).
        const color = base.clone().lerp(white, bright ? 0.3 : 0.08 + random() * 0.15);
        colors.push(color.r, color.g, color.b);
        sizes.push(bright ? 0.26 + random() * 0.18 : 0.1 + random() * 0.16);
      }
    });
    this.count = this.particles.length;
    this.positions = new Float32Array(this.count * 3);
    this.alphas = new Float32Array(this.count);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('aAlpha', new BufferAttribute(this.alphas, 1));
    geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1));
    this.points = new Points(
      geometry,
      new ShaderMaterial({
        vertexShader: POINTS_VERTEX,
        fragmentShader: POINTS_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uScale: { value: 600 } },
      }),
    );
    this.points.name = 'particle-flow';
    this.points.frustumCulled = false;
    this.step(0, 0);
  }

  attach(scene: Scene): void {
    scene.add(this.points);
  }

  /** Resalta las motas de una línea y atenúa las demás; `null` = todas neutras. */
  highlight(id: string | null): void {
    this.paths.forEach((item, index) => {
      this.emphasisTarget[index] = id === null ? 1 : item.id === id ? 1.6 : 0.25;
    });
  }

  /** Realce actual de cada ruta (1 = neutro). */
  get emphasisLevels(): readonly number[] {
    return this.emphasis;
  }

  update(frame: FrameContext): void {
    for (let i = 0; i < this.emphasis.length; i += 1) {
      this.emphasis[i] = frame.reducedMotion
        ? this.emphasisTarget[i]
        : damp(this.emphasis[i], this.emphasisTarget[i], 8, frame.delta);
    }
    this.points.material.uniforms.uScale.value = frame.viewport.height * 0.9;
    // Con movimiento reducido las motas siguen ahí pero casi quietas.
    this.step(frame.delta * (frame.reducedMotion ? 0.12 : 1), frame.time);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }

  private step(delta: number, time: number): void {
    const { positions, alphas } = this;
    for (let i = 0; i < this.count; i += 1) {
      const particle = this.particles[i];
      const { path, dissolve = 0, focus } = this.paths[particle.pathIndex];
      const tail = dissolve > 0 ? Math.max(0, (particle.t - (1 - dissolve)) / dissolve) : 0;
      // Foco local: fuera de foco las motas van más despacio, hay menos y brillan menos.
      const f = readTable(focus, particle.t);
      // En la zona de disolución las motas frenan: se quedan flotando mientras se apagan.
      const slow = (1 - 0.55 * tail) * (0.45 + 0.55 * f);
      particle.t += (particle.speed * this.options.speed * delta * slow) / Math.max(1, path.length);
      if (particle.t > 1) particle.t -= 1;
      path.sample(particle.t, positions, i * 3);
      const k = dissolve > 0 ? Math.max(0, (particle.t - (1 - dissolve)) / dissolve) : 0;
      const scatter = k * k;
      const orbit = particle.orbit * (1 + scatter * DISSOLVE_SPREAD);
      const angle = particle.angle + time * particle.spin;
      positions[i * 3 + 1] += Math.cos(angle) * orbit + scatter * DISSOLVE_RISE * (0.4 + particle.orbit);
      positions[i * 3 + 2] += Math.sin(angle) * orbit;
      const fadeOut = dissolve > 0 ? 1 - smoothstep(0.45, 1, k) : 1 - smoothstep(0.9, 1, particle.t);
      const density = 0.15 + 0.95 * f;
      const shown = 1 - smoothstep(density - 0.08, density + 0.08, particle.rank);
      // En la banda de los nodos (y ≈ 0) las motas se apagan: no ensucian los símbolos.
      const clearBand = BAND_CLEAR_MIN + (1 - BAND_CLEAR_MIN) * smoothstep(0.5, 1.8, Math.abs(positions[i * 3 + 1]));
      alphas[i] =
        smoothstep(0, 0.04, particle.t) * fadeOut * shown * (0.45 + 0.55 * f) * clearBand * this.emphasis[particle.pathIndex];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
