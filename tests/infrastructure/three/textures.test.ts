import { describe, expect, it } from 'vitest';
import { createGlowTexture, createRingTexture } from '../../../src/infrastructure/three/textures';

function alphaAt(texture: { image: { data: ArrayLike<number> | null; width: number } }, x: number, y: number): number {
  const data = texture.image.data;
  if (!data) throw new Error('textura sin datos');
  return data[(y * texture.image.width + x) * 4 + 3];
}

describe('texturas procedurales', () => {
  it('resplandor: opaco en el centro, transparente en el borde, decreciente y blanco', () => {
    const texture = createGlowTexture(33);
    expect(texture.image.width).toBe(33);
    expect(texture.image.height).toBe(33);
    expect(alphaAt(texture, 16, 16)).toBe(255);
    expect(alphaAt(texture, 0, 16)).toBe(0);
    expect(alphaAt(texture, 0, 0)).toBe(0);
    for (let x = 17; x <= 32; x += 1) expect(alphaAt(texture, x, 16)).toBeLessThanOrEqual(alphaAt(texture, x - 1, 16));
    const data = texture.image.data as Uint8Array;
    for (let i = 0; i < data.length; i += 4) expect(data[i] + data[i + 1] + data[i + 2]).toBe(765);
  });

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
    expect(createGlowTexture().image.width).toBe(128);
    expect(createRingTexture().image.width).toBe(256);
  });
});
