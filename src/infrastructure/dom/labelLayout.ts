export interface LabelCandidate {
  readonly id: string;
  /** Centro horizontal de la etiqueta, en píxeles. */
  readonly x: number;
  /** Posiciones verticales posibles (borde superior), por orden de preferencia. */
  readonly ys: readonly number[];
  readonly width: number;
  readonly height: number;
  /** Mayor = se coloca antes (gana en caso de solape). */
  readonly priority: number;
}

/** Algo que las etiquetas ajenas no deben tapar (el disco de un nodo). */
export interface Obstacle {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const intersects = (a: Box, b: Box, padding: number): boolean =>
  a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding;

/**
 * Elige qué etiquetas mostrar y dónde, sin que se pisen entre sí ni tapen otros nodos:
 * recorre por prioridad y prueba cada posición candidata. Devuelve id → y elegida. Puro.
 */
export function layoutLabels(
  candidates: readonly LabelCandidate[],
  viewport: Viewport,
  obstacles: readonly Obstacle[] = [],
  /** Zonas ya ocupadas por la interfaz (p. ej. la cabecera) donde no debe caer ningún rótulo. */
  reserved: readonly Box[] = [],
  padding = 6,
): Map<string, number> {
  const placed: Box[] = [...reserved];
  const result = new Map<string, number>();
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const candidate of sorted) {
    const left = candidate.x - candidate.width / 2;
    const right = candidate.x + candidate.width / 2;
    if (right < 0 || left > viewport.width) continue;
    for (const top of candidate.ys) {
      const box: Box = { left, right, top, bottom: top + candidate.height };
      if (box.top < 0 || box.bottom > viewport.height) continue;
      if (placed.some((other) => intersects(box, other, padding))) continue;
      const blocked = obstacles.some(
        (obstacle) =>
          obstacle.id !== candidate.id &&
          intersects(
            box,
            {
              left: obstacle.x - obstacle.radius,
              right: obstacle.x + obstacle.radius,
              top: obstacle.y - obstacle.radius,
              bottom: obstacle.y + obstacle.radius,
            },
            2,
          ),
      );
      if (blocked) continue;
      placed.push(box);
      result.set(candidate.id, top);
      break;
    }
  }
  return result;
}

/** Cada cuántos años se rotula la regla según el espacio disponible entre marcas. */
export function yearStep(pixelsPerYear: number, minLabelSpacing = 56): number {
  if (!(pixelsPerYear > 0)) return 10;
  for (const step of [1, 2, 5, 10, 20, 50]) {
    if (pixelsPerYear * step >= minLabelSpacing) return step;
  }
  return 100;
}

/** Distancia de cámara a partir de la cual deja de rotularse un nodo de cierta importancia. */
export function labelDistanceLimit(importance: number): number {
  if (importance >= 3) return Infinity;
  return importance === 2 ? 58 : 30;
}
