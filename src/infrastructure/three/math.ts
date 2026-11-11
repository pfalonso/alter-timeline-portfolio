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

/** Franjas de la ventana (píxeles CSS) tapadas por la interfaz: la escena se encuadra entre ellas. */
export interface SafeInsets {
  readonly top: number;
  readonly bottom: number;
}

/** Fracción mínima del alto que se reserva a la escena aunque la interfaz ocupe más. */
const MIN_BAND = 0.35;

/** Fracción del alto de la ventana libre para la escena (entre las franjas reservadas). */
export function bandFraction(viewportHeight: number, insets: SafeInsets): number {
  const height = Math.max(1, viewportHeight);
  return clamp(1 - (insets.top + insets.bottom) / height, MIN_BAND, 1);
}

/**
 * Desplazamiento vertical (en fracción del alto) del centro de la franja libre respecto al centro
 * de la ventana: positivo si la franja queda por encima. Se limita para que la franja mínima quepa.
 */
export function bandOffset(viewportHeight: number, insets: SafeInsets): number {
  const height = Math.max(1, viewportHeight);
  const limit = (1 - bandFraction(viewportHeight, insets)) / 2;
  return clamp((insets.bottom - insets.top) / (2 * height), -limit, limit);
}

/** Extensión vertical de las ramas dentro de [fromX, toX], o `null` si ninguna pasa por ahí. */
export function verticalExtent(
  branches: readonly { readonly points: readonly Vec3[] }[],
  fromX: number,
  toX: number,
): { minY: number; maxY: number } | null {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const branch of branches) {
    for (const point of branch.points) {
      if (point.x < fromX || point.x > toX) continue;
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  return minY <= maxY ? { minY, maxY } : null;
}

/**
 * Interpola `values[i]` (uno por punto) en la X dada. Los puntos van en orden creciente de X (como
 * las polilíneas del layout); fuera del rango devuelve el extremo. Sin valores, 1.
 */
export function valueAtX(points: readonly Vec3[], values: readonly number[] | undefined, x: number): number {
  if (!values || values.length === 0 || points.length === 0) return 1;
  const n = Math.min(points.length, values.length);
  if (x <= points[0].x) return values[0];
  if (x >= points[n - 1].x) return values[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const span = points[hi].x - points[lo].x;
  return lerp(values[lo], values[hi], span > 0 ? (x - points[lo].x) / span : 0);
}

/** Tabla de `samples` valores a lo largo de la longitud de `path` (t uniforme), leídos por X. */
export function sampleAlongPath(
  path: PathTable,
  points: readonly Vec3[],
  values: readonly number[] | undefined,
  samples = 64,
): Float32Array {
  const table = new Float32Array(samples);
  const scratch = [0, 0, 0];
  for (let i = 0; i < samples; i += 1) {
    path.sample(i / (samples - 1), scratch);
    table[i] = valueAtX(points, values, scratch[0]);
  }
  return table;
}

/** Lee una tabla uniforme (de `sampleAlongPath`) en t ∈ [0,1] con interpolación lineal. */
export function readTable(table: Float32Array | undefined, t: number): number {
  if (!table || table.length === 0) return 1;
  if (table.length === 1) return table[0];
  const f = clamp(t, 0, 1) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(f));
  return lerp(table[i], table[i + 1], f - i);
}

/** Y de una polilínea en una X (interpolada); `null` si la X cae fuera de ella. */
export function yOnLine(points: readonly Vec3[] | undefined, x: number): number | null {
  if (!points || points.length === 0 || x < points[0].x - 1e-6 || x > points[points.length - 1].x + 1e-6) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const span = points[hi].x - points[lo].x;
  return lerp(points[lo].y, points[hi].y, span > 0 ? (x - points[lo].x) / span : 0);
}

/**
 * Ruta del vuelo del modo historia entre dos nodos: avanza por el tiempo (X) pegada a la línea de
 * salida y pasa con suavidad a la línea de llegada, en vez de cortar en línea recta. Donde una
 * línea no llega (antes de nacer o tras cerrarse) se usa la recta entre ambos nodos.
 */
export function storyRoute(
  from: Vec3,
  to: Vec3,
  fromLine?: readonly Vec3[],
  toLine?: readonly Vec3[],
  samples = 24,
): { x: number; y: number }[] {
  const route: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = lerp(from.x, to.x, t);
    const straight = lerp(from.y, to.y, t);
    const a = yOnLine(fromLine, x) ?? straight;
    const b = yOnLine(toLine, x) ?? straight;
    const w = smoothstep(0, 1, t);
    route.push({ x, y: a * (1 - w) + b * w });
  }
  route[0] = { x: from.x, y: from.y };
  route[samples] = { x: to.x, y: to.y };
  return route;
}

/** Punto de una ruta (polilínea) en t ∈ [0,1], uniforme en el índice. */
export function pointOnRoute(route: readonly { x: number; y: number }[], t: number): { x: number; y: number } {
  if (route.length === 0) return { x: 0, y: 0 };
  const f = clamp(t, 0, 1) * (route.length - 1);
  const i = Math.min(route.length - 2, Math.floor(f));
  if (i < 0) return route[0];
  const k = f - i;
  return { x: lerp(route[i].x, route[i + 1].x, k), y: lerp(route[i].y, route[i + 1].y, k) };
}

/** Curva de aceleración suave (entrada y salida). */
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
