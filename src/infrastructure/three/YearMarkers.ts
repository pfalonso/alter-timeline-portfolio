import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, type Scene } from 'three';
import type { LayoutBounds, YearMark } from '../../domain/services';
import type { SceneEffect } from './SceneEffect';

/** Meridianos tenues: una línea vertical por año cruzando todos los carriles. */
export class YearMarkers implements SceneEffect {
  readonly lines: LineSegments<BufferGeometry, LineBasicMaterial>;

  constructor(years: readonly YearMark[], bounds: LayoutBounds, color = '#8fb6ff') {
    const vertices: number[] = [];
    for (const mark of years) {
      vertices.push(mark.x, bounds.minY - 9, -1.5, mark.x, bounds.maxY + 9, -1.5);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color, transparent: true, opacity: 0.045, depthWrite: false }),
    );
    this.lines.name = 'year-markers';
  }

  attach(scene: Scene): void {
    scene.add(this.lines);
  }

  update(): void {
    // Estático.
  }

  dispose(): void {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}
