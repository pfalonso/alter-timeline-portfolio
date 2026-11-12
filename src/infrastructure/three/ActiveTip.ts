import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, type Scene } from 'three';
import type { Vec3 } from '../../domain/services';
import { PathTable } from './math';
import { POINTS_FRAGMENT, POINTS_VERTEX } from './ParticleFlow';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

export interface ActiveTipOptions {
  /** Velocidad de la punta (unidades de mundo por segundo). */
  readonly speed: number;
  /** Duración mínima de un recorrido (s): en tramos cortos la punta no corre. */
  readonly minPeriod: number;
  /** Nº de motas de la estela tras la punta. */
  readonly trail: number;
}

export const DEFAULT_ACTIVE_TIP: ActiveTipOptions = { speed: 1.1, minPeriod: 4.5, trail: 7 };

/**
 * Proyecto en activo: una punta de luz que recorre su línea desde el nodo hasta el borde derecho
 * (como si se siguiera escribiendo), con una estela corta, y una plumilla fija al final. Con
 * movimiento reducido, la punta queda quieta en el extremo.
 */
export class ActiveTip implements SceneEffect {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly table: PathTable;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly options: ActiveTipOptions;
  private readonly period: number;

  constructor(
    readonly id: string,
    path: readonly Vec3[],
    color: string,
    options: Partial<ActiveTipOptions> = {},
  ) {
    this.options = { ...DEFAULT_ACTIVE_TIP, ...options };
    this.table = new PathTable(path, 128);
    this.period = Math.max(this.options.minPeriod, this.table.length / this.options.speed);
    // Mota 0: plumilla fija al final; 1: la punta; resto: estela.
    const count = this.options.trail + 2;
    this.positions = new Float32Array(count * 3);
    this.alphas = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const base = new Color(color);
    const bright = base.clone().lerp(new Color('#ffffff'), 0.55);
    bright.toArray(colors, 0);
    sizes[0] = 0.32;
    bright.toArray(colors, 3);
    sizes[1] = 0.5;
    for (let i = 2; i < count; i += 1) {
      base.clone().lerp(new Color('#ffffff'), 0.25).toArray(colors, i * 3);
      sizes[i] = 0.34 * (1 - (i - 2) / count);
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
    this.points.name = `active-tip:${id}`;
    this.points.frustumCulled = false;
    this.place(1, false);
  }

  attach(scene: Scene): void {
    scene.add(this.points);
  }

  update(frame: FrameContext): void {
    this.points.material.uniforms.uScale.value = frame.viewport.height * 0.9;
    this.place(frame.reducedMotion ? 1 : (frame.time / this.period) % 1, !frame.reducedMotion);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }

  /** Coloca la punta en `t` (0 = nodo, 1 = final); `moving` añade aparición/desaparición. */
  private place(t: number, moving: boolean): void {
    const { positions, alphas, table } = this;
    table.sample(1, positions, 0);
    alphas[0] = 0.5;
    // Aparece despacio al salir del nodo y se funde con la plumilla al llegar.
    const envelope = moving ? Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.1) : 0.9;
    const spacing = Math.min(0.03, 0.35 / Math.max(0.1, table.length));
    for (let i = 1; i < alphas.length; i += 1) {
      const k = i - 1;
      table.sample(t - k * spacing, positions, i * 3);
      alphas[i] = envelope * (k === 0 ? 0.95 : 0.55 * (1 - k / alphas.length));
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
