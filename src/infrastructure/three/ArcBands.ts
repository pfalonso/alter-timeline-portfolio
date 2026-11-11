import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  type Scene,
} from 'three';
import type { LayoutArc, LayoutBounds } from '../../domain/services';
import { damp } from './math';
import type { SceneEffect } from './SceneEffect';
import type { FrameContext } from './types';

/** Opacidades (antes del perfil vertical) del velo y del separador, en reposo y con la cámara dentro. */
export const ARC_OPACITY = {
  // En el rango oscuro, una suma lineal mínima ya se ve tras el sRGB: el velo solo existe en el arco activo.
  veil: { idle: 0, active: 0.014 },
  edge: { idle: 0.07, active: 0.2 },
} as const;

/** Arco (id) que contiene la X del mundo, o `null`. */
export function activeArcAt(arcs: readonly LayoutArc[], x: number): string | null {
  for (const arc of arcs) if (x >= arc.startX && x < arc.endX) return arc.id;
  return null;
}

/**
 * Rectángulo vertical con alfa por vértice: transparente arriba y abajo, máximo en el centro, y
 * con los bordes laterales difuminados a lo largo de `feather` unidades. Así velos y separadores
 * son etéreos, sin cortes duros.
 */
function verticalVeil(x0: number, x1: number, y0: number, y1: number, z: number, feather = 0, rows = 8): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const f = Math.min(feather, (x1 - x0) / 2);
  const xs = f > 0 ? [x0, x0 + f, x1 - f, x1] : [x0, x1];
  const side = (i: number): number => (f > 0 && (i === 0 || i === xs.length - 1) ? 0 : 1);
  const cols = xs.length;
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const y = y0 + (y1 - y0) * t;
    const alpha = Math.sin(Math.PI * t) ** 1.6;
    xs.forEach((x, i) => {
      positions.push(x, y, z);
      colors.push(1, 1, 1, alpha * side(i));
    });
    if (row > 0) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = (row - 1) * cols + c;
        const b = row * cols + c;
        index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  return geometry;
}

interface Band {
  readonly id: string;
  readonly veil: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly edge: Mesh<BufferGeometry, MeshBasicMaterial>;
  level: number;
}

/**
 * Arcos temporales (capítulos): un velo muy tenue por capítulo y un separador vertical etéreo al
 * principio de cada uno. El capítulo en el que está la cámara se ilumina un poco.
 */
export class ArcBands implements SceneEffect {
  readonly bands: readonly Band[];
  private activeId: string | null = null;

  constructor(arcs: readonly LayoutArc[], bounds: LayoutBounds, color = '#9fc4ff') {
    const y0 = bounds.minY - 12;
    const y1 = bounds.maxY + 12;
    const tint = new Color(color);
    // Velo aditivo (casi imperceptible); separador con mezcla normal para que el bloom no lo queme.
    const material = (opacity: number, additive: boolean): MeshBasicMaterial =>
      new MeshBasicMaterial({
        color: tint,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: additive ? AdditiveBlending : NormalBlending,
      });
    this.bands = arcs.map((arc) => {
      const feather = (arc.endX - arc.startX) * 0.3;
      const veil = new Mesh(verticalVeil(arc.startX, arc.endX, y0, y1, -7, feather), material(ARC_OPACITY.veil.idle, true));
      const edge = new Mesh(verticalVeil(arc.startX - 0.04, arc.startX + 0.04, y0, y1, -1.2), material(ARC_OPACITY.edge.idle, false));
      veil.name = `arc-veil:${arc.id}`;
      edge.name = `arc-edge:${arc.id}`;
      return { id: arc.id, veil, edge, level: 0 };
    });
  }

  get active(): string | null {
    return this.activeId;
  }

  /** Capítulo en el que está la cámara (lo calcula la vista con la X a la que mira). */
  setActive(id: string | null): void {
    this.activeId = id;
  }

  attach(scene: Scene): void {
    for (const band of this.bands) scene.add(band.veil, band.edge);
  }

  update(frame: FrameContext): void {
    this.bands.forEach((band) => {
      const target = band.id === this.activeId ? 1 : 0;
      band.level = frame.reducedMotion ? target : damp(band.level, target, 2.5, frame.delta);
      const veil = ARC_OPACITY.veil;
      const edge = ARC_OPACITY.edge;
      band.veil.material.opacity = veil.idle + (veil.active - veil.idle) * band.level;
      band.veil.visible = band.veil.material.opacity > 0.0005;
      band.edge.material.opacity = edge.idle + (edge.active - edge.idle) * band.level;
    });
  }

  dispose(): void {
    for (const band of this.bands) {
      for (const mesh of [band.veil, band.edge]) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
  }
}
