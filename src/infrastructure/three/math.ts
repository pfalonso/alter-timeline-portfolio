import type { Vec3 } from '../../domain/services';

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Amortiguación exponencial independiente del framerate. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** PRNG determinista (mulberry32): la escena es idéntica en cada carga. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Polilínea remuestreada a distancia de arco uniforme para consultarla barato cada fotograma. */
export class PathTable {
  readonly length: number;
  private readonly data: Float32Array;
  private readonly count: number;

  constructor(points: readonly Vec3[], samples = 0) {
    if (points.length < 2) throw new Error('PathTable necesita al menos dos puntos');
    const cumulative = [0];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    this.length = cumulative[cumulative.length - 1];
    this.count = Math.max(2, samples > 0 ? samples : points.length);
    this.data = new Float32Array(this.count * 3);
    let segment = 1;
    for (let i = 0; i < this.count; i += 1) {
      const distance = (this.length * i) / (this.count - 1);
      while (segment < points.length - 1 && cumulative[segment] < distance) segment += 1;
      const span = cumulative[segment] - cumulative[segment - 1];
      const t = span > 0 ? (distance - cumulative[segment - 1]) / span : 0;
      const a = points[segment - 1];
      const b = points[segment];
      this.data[i * 3] = lerp(a.x, b.x, t);
      this.data[i * 3 + 1] = lerp(a.y, b.y, t);
      this.data[i * 3 + 2] = lerp(a.z, b.z, t);
    }
  }

  /** Escribe en `out[offset..offset+2]` el punto en `t` ∈ [0,1] (fracción de la longitud). */
  sample(t: number, out: Float32Array | number[], offset = 0): void {
    const f = clamp(t, 0, 1) * (this.count - 1);
    const i = Math.min(this.count - 2, Math.floor(f));
    const k = f - i;
    const d = this.data;
    out[offset] = lerp(d[i * 3], d[i * 3 + 3], k);
    out[offset + 1] = lerp(d[i * 3 + 1], d[i * 3 + 4], k);
    out[offset + 2] = lerp(d[i * 3 + 2], d[i * 3 + 5], k);
  }
}

export interface Pickable {
  readonly eventId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly presence: number;
  readonly inFront: boolean;
}

/**
 * Devuelve el nodo bajo el puntero (en píxeles). Usa un radio mínimo generoso para dedos
 * y descarta los nodos atenuados por el filtro.
 */
export function pickNode(nodes: readonly Pickable[], x: number, y: number, minRadius = 18): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const node of nodes) {
    if (!node.inFront || node.presence < 0.5) continue;
    const reach = Math.max(node.radius * 1.6, minRadius);
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance > reach) continue;
    const score = distance / reach;
    if (score < bestScore) {
      bestScore = score;
      best = node.eventId;
    }
  }
  return best;
}
