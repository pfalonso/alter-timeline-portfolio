import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type Scene,
} from 'three';
import type { Vec3 } from '../../domain/services';
import { createRandom } from './math';
import { POINTS_FRAGMENT, POINTS_VERTEX } from './ParticleFlow';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

export interface MergeSeamOptions {
  /** Nº de motas de la costura. */
  readonly count: number;
  /** Radio del remolino (unidades de mundo). */
  readonly radius: number;
  readonly seed: number;
  /** Tamaño del destello central (0 = sin destello: remolino de pigmento de las hebras causales). */
  readonly core: number;
}

export const DEFAULT_SEAM_OPTIONS: MergeSeamOptions = { count: 90, radius: 1.5, seed: 11, core: 2.6 };

interface Mote {
  readonly angle: number;
  readonly spin: number;
  readonly orbit: number;
  readonly tilt: number;
  readonly phase: number;
}

/**
 * «Costura» donde una línea vital converge en otra: un destello que late y un remolino de motas
 * con los colores de las dos líneas que se cierra sobre el punto de fusión. Con movimiento reducido
 * queda quieto.
 */
export class MergeSeam implements SceneEffect {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly motes: Mote[] = [];
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly options: MergeSeamOptions;

  constructor(
    readonly id: string,
    private readonly center: Vec3,
    fromColor: string,
    intoColor: string,
    options: Partial<MergeSeamOptions> = {},
  ) {
    this.options = { ...DEFAULT_SEAM_OPTIONS, ...options };
    const random = createRandom(this.options.seed);
    const count = this.options.count + 1;
    this.positions = new Float32Array(count * 3);
    this.alphas = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const a = new Color(fromColor);
    const b = new Color(intoColor);
    const white = new Color('#ffffff');
    // Mota 0: el destello central.
    (this.options.core > 0 ? white : a.clone().lerp(b, 0.5)).toArray(colors, 0);
    sizes[0] = this.options.core;
    for (let i = 1; i < count; i += 1) {
      this.motes.push({
        angle: random() * Math.PI * 2,
        spin: (random() < 0.5 ? -1 : 1) * (0.6 + random() * 1.2),
        orbit: 0.25 + Math.pow(random(), 0.7) * this.options.radius,
        tilt: (random() - 0.5) * 1.6,
        phase: random(),
      });
      a.clone().lerp(b, random()).lerp(white, 0.2 + random() * 0.35).toArray(colors, i * 3);
      sizes[i] = 0.14 + random() * 0.26;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('aAlpha', new BufferAttribute(this.alphas, 1));
    geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
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
    this.points.name = `merge-seam:${id}`;
    this.points.frustumCulled = false;
    this.place(0);
  }

  attach(scene: Scene): void {
    scene.add(this.points);
  }

  update(frame: FrameContext): void {
    this.points.material.uniforms.uScale.value = frame.viewport.height * 0.9;
    this.place(frame.reducedMotion ? 0 : frame.time);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }

  private place(time: number): void {
    const { positions, alphas, center } = this;
    positions[0] = center.x;
    positions[1] = center.y;
    positions[2] = center.z;
    alphas[0] = 0.55 + 0.3 * Math.sin(time * 1.8);
    this.motes.forEach((mote, index) => {
      const i = index + 1;
      // Cada mota cae en espiral hacia la costura y vuelve a empezar: las dos líneas se cosen.
      const life = (mote.phase + time * 0.18) % 1;
      const r = mote.orbit * (1 - life * 0.85);
      const angle = mote.angle + time * mote.spin + life * 4;
      positions[i * 3] = center.x + Math.cos(angle) * r * 0.6;
      positions[i * 3 + 1] = center.y + Math.sin(angle) * r + mote.tilt * r * 0.3;
      positions[i * 3 + 2] = center.z + Math.sin(angle + mote.tilt) * r * 0.7;
      alphas[i] = Math.sin(Math.PI * life) * 0.85;
    });
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
