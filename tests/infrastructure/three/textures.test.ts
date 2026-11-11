import { describe, expect, it } from 'vitest';
import { createRingTexture } from '../../../src/infrastructure/three/textures';

function alphaAt(texture: { image: { data: ArrayLike<number> | null; width: number } }, x: number, y: number): number {
  const data = texture.image.data;
  if (!data) throw new Error('textura sin datos');
  return data[(y * texture.image.width + x) * 4 + 3];
}

describe('texturas procedurales', () => {
  it('anillo: el máximo está cerca del borde (r ≈ 0,86), con centro y esquinas casi transparentes', () => {
    const size = 201;
    const texture = createRingTexture(size);
    const row = Array.from({ length: size }, (_, x) => alphaAt(texture, x, 100));
    const peak = row.indexOf(Math.max(...row.slice(100)), 100);
    expect((peak - 100) / 100).toBeCloseTo(0.86, 1);
    expect(row[peak]).toBeGreaterThan(240);
    expect(row[100]).toBe(0);
    expect(row[150]).toBeLessThan(10);
    expect(alphaAt(texture, 0, 0)).toBe(0);
    // Simétrico.
    expect(row[100 - (peak - 100)]).toBe(row[peak]);
  });

  it('tamaños por defecto', () => {
    expect(createRingTexture().image.width).toBe(256);
  });
});
