import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';

function build(size: number, alphaAt: (radius: number) => number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const radius = Math.hypot(x - half, y - half) / half;
      const alpha = Math.min(1, Math.max(0, alphaAt(radius)));
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Anillo fino con un halo interior tenue. */
export function createRingTexture(size = 256): DataTexture {
  return build(size, (r) => {
    const ring = Math.exp(-Math.pow((r - 0.86) / 0.022, 2));
    const inner = r < 0.86 ? 0.06 * Math.pow(r / 0.86, 3) : 0;
    return ring + inner;
  });
}
