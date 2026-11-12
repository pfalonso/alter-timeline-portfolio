import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  WireframeGeometry,
} from 'three';
import type { LineStyle } from '../../domain/model';

/**
 * Sólidos en *wireframe* de los nodos, a radio 1 (el nodo los escala). Cada forma tiene:
 * - `wire`: aristas luminosas (`LineSegments`);
 * - `inner`: segunda estructura que gira al revés (cubo inscrito, anillo interior) o `null`;
 * - `fill`: volumen para el relleno interior tenue (tapa lo que pasa por detrás).
 */
export interface NodeShape {
  readonly wire: BufferGeometry;
  readonly inner: BufferGeometry | null;
  readonly fill: BufferGeometry;
}

/** Anillo (circunferencia) de radio `r` como segmentos, girado `tiltX`/`tiltY` radianes. */
export function ringGeometry(r: number, segments = 48, tiltX = 0, tiltY = 0): BufferGeometry {
  const positions = new Float32Array(segments * 6);
  const point = (i: number, out: number): void => {
    const a = (i / segments) * Math.PI * 2;
    // Circunferencia en XY, girada sobre X y después sobre Y.
    const x0 = Math.cos(a) * r;
    const y0 = Math.sin(a) * r;
    const y1 = y0 * Math.cos(tiltX);
    const z1 = y0 * Math.sin(tiltX);
    positions[out] = x0 * Math.cos(tiltY) + z1 * Math.sin(tiltY);
    positions[out + 1] = y1;
    positions[out + 2] = -x0 * Math.sin(tiltY) + z1 * Math.cos(tiltY);
  };
  for (let i = 0; i < segments; i += 1) {
    point(i, i * 6);
    point(i + 1, i * 6 + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

/** Une varias geometrías de segmentos en una sola (mismo atributo `position`). */
export function mergeSegments(parts: readonly BufferGeometry[]): BufferGeometry {
  const arrays = parts.map((part) => part.getAttribute('position').array as Float32Array);
  const merged = new Float32Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    merged.set(array, offset);
    offset += array.length;
  }
  for (const part of parts) part.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(merged, 3));
  return geometry;
}

/**
 * Deforma una esfera con un ruido suave y determinista (función de la posición: los vértices
 * repetidos de una geometría no indexada se mueven igual y la malla no se abre).
 */
export function deformSphere(geometry: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const k =
      1 +
      amount * (Math.sin(3.1 * x + seed) * Math.sin(2.3 * y + 1.7 * seed) + 0.6 * Math.sin(2.7 * z + 0.4 * seed));
    position.setXYZ(i, x * k, y * k, z * k);
  }
  position.needsUpdate = true;
  return geometry;
}

const edges = (geometry: BufferGeometry): BufferGeometry => {
  const result = new EdgesGeometry(geometry);
  geometry.dispose();
  return result;
};
const wireframe = (geometry: BufferGeometry): BufferGeometry => {
  const result = new WireframeGeometry(geometry);
  geometry.dispose();
  return result;
};

/** Forma de un nodo según el lenguaje de su línea y su peso. Se distinguen por peso de un vistazo. */
export function createNodeShape(style: LineStyle, importance: 1 | 2 | 3): NodeShape {
  if (style === 'geometric') {
    // Poliedros rectilíneos: icosaedro con cubo inscrito, octaedro, tetraedro.
    if (importance === 3) {
      return { wire: edges(new IcosahedronGeometry(1, 0)), inner: edges(new BoxGeometry(1.05, 1.05, 1.05)), fill: new IcosahedronGeometry(0.97, 0) };
    }
    if (importance === 2) return { wire: edges(new OctahedronGeometry(1, 0)), inner: null, fill: new OctahedronGeometry(0.96, 0) };
    return { wire: edges(new TetrahedronGeometry(1, 0)), inner: null, fill: new TetrahedronGeometry(0.95, 0) };
  }
  if (style === 'organic') {
    // Formas curvas: nudo toroidal, esfera deformada, esfera pequeña de baja resolución.
    if (importance === 3) {
      return {
        wire: wireframe(new TorusKnotGeometry(0.6, 0.2, 48, 5, 2, 3)),
        inner: null,
        fill: new TorusKnotGeometry(0.6, 0.19, 48, 5, 2, 3),
      };
    }
    if (importance === 2) {
      return { wire: wireframe(deformSphere(new IcosahedronGeometry(1, 1), 0.14, 1.3)), inner: null, fill: deformSphere(new IcosahedronGeometry(0.96, 1), 0.14, 1.3) };
    }
    return { wire: wireframe(new SphereGeometry(1, 7, 5)), inner: null, fill: new SphereGeometry(0.95, 7, 5) };
  }
  // Neutro (vida): anillos. Giroscopio de tres anillos, toro fino, un anillo.
  if (importance === 3) {
    return {
      wire: mergeSegments([ringGeometry(1, 56), ringGeometry(0.86, 48, Math.PI / 2)]),
      inner: ringGeometry(0.7, 40, Math.PI / 4, Math.PI / 2),
      fill: new SphereGeometry(0.36, 10, 8),
    };
  }
  if (importance === 2) return { wire: wireframe(new TorusGeometry(0.88, 0.16, 4, 22)), inner: null, fill: new TorusGeometry(0.88, 0.15, 4, 22) };
  return { wire: ringGeometry(1, 32), inner: null, fill: new TorusGeometry(1, 0.1, 3, 24) };
}
