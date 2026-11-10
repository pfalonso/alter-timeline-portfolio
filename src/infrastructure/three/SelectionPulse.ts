import { AdditiveBlending, Color, Sprite, SpriteMaterial, type Scene, type Texture } from 'three';
import type { Vec3 } from '../../domain/services';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

interface Ring {
  readonly sprite: Sprite;
  /** Segundos transcurridos; negativo = aún en espera. */
  age: number;
  active: boolean;
}

/** Onda expansiva al seleccionar un nodo: anillos concéntricos que crecen y se apagan. */
export class SelectionPulse implements SceneEffect {
  readonly rings: Ring[];
  private baseRadius = 1;

  constructor(
    ringTexture: Texture,
    private readonly duration = 1.25,
    ringCount = 3,
    private readonly stagger = 0.16,
  ) {
    this.rings = Array.from({ length: ringCount }, () => {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: ringTexture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          blending: AdditiveBlending,
          fog: false,
        }),
      );
      sprite.visible = false;
      sprite.renderOrder = 5;
      return { sprite, age: 0, active: false };
    });
  }

  attach(scene: Scene): void {
    for (const ring of this.rings) scene.add(ring.sprite);
  }

  trigger(position: Vec3, color: string, radius: number): void {
    this.baseRadius = radius;
    const tint = new Color(color).lerp(new Color('#ffffff'), 0.35);
    this.rings.forEach((ring, index) => {
      ring.sprite.position.set(position.x, position.y, position.z);
      ring.sprite.material.color.copy(tint);
      ring.age = -index * this.stagger;
      ring.active = true;
    });
  }

  get isActive(): boolean {
    return this.rings.some((ring) => ring.active);
  }

  update(frame: FrameContext): void {
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += frame.delta;
      const progress = ring.age / this.duration;
      if (progress >= 1 || frame.reducedMotion) {
        ring.active = false;
        ring.sprite.visible = false;
        continue;
      }
      if (progress < 0) continue;
      const eased = 1 - Math.pow(1 - progress, 3);
      const scale = this.baseRadius * (3 + eased * 22);
      ring.sprite.visible = true;
      ring.sprite.scale.set(scale, scale, 1);
      ring.sprite.material.opacity = Math.pow(1 - progress, 2) * 0.9;
    }
  }

  dispose(): void {
    for (const ring of this.rings) {
      ring.sprite.removeFromParent();
      ring.sprite.material.dispose();
    }
  }
}
