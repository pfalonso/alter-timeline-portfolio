import { Color, Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WATERCOLOR,
  MAX_PIGMENTS,
  PAPER_FRAGMENT,
  WASH_FRAGMENT,
  WatercolorPass,
  WatercolorWash,
  type PigmentLine,
} from '../../../src/infrastructure/three/Watercolor';
import { frameContext } from '../../helpers/three';

const line = (color: string, focus: number, main = false, from = 0, to = 100): PigmentLine => ({
  color,
  main,
  points: [
    { x: from, y: 0, z: 0 },
    { x: to, y: 0, z: 0 },
  ],
  focus: [focus, focus],
});

describe('WatercolorWash', () => {
  it('lleva un pigmento por línea (hasta el máximo) sobre papel oscuro, no negro', () => {
    const lines = Array.from({ length: 8 }, (_, i) => line(`#${(i + 1).toString(16).repeat(6)}`, 0.3));
    const wash = new WatercolorWash(lines);
    const uniforms = wash.material.uniforms;
    expect(uniforms.uCount.value).toBe(MAX_PIGMENTS);
    expect((uniforms.uColors.value as Color[]).length).toBe(MAX_PIGMENTS);
    const paper = new Color(DEFAULT_WATERCOLOR.paper);
    expect(paper.getHex()).not.toBe(0);
    // Índigo/ciruela: más azul que verde.
    expect(paper.b).toBeGreaterThan(paper.g);
  });

  it('el shader hace domain warping con fbm, borde acumulado y sangrados; la composición añade grano y papel', () => {
    for (const piece of ['fbm(p + 3.4 * r)', 'rim', 'bleed', 'uFocusColor']) expect(WASH_FRAGMENT).toContain(piece);
    for (const piece of ['gran', 'fiber', 'tWash']) expect(PAPER_FRAGMENT).toContain(piece);
  });

  it('focusAt elige la línea con más foco en esa X (la central gana los empates)', () => {
    const wash = new WatercolorWash([line('#ff0000', 0.3), line('#00ff00', 1, false, 50, 100), line('#0000ff', 0.3, true)]);
    expect(wash.focusAt(10)?.color).toBe('#0000ff');
    expect(wash.focusAt(70)?.color).toBe('#00ff00');
    expect(wash.focusAt(500)).toBeNull();
  });

  it('fluye con el tiempo, se desplaza un poco con la cámara y se tiñe hacia la línea en foco', () => {
    const wash = new WatercolorWash([line('#ff0000', 1, true), line('#00ff00', 0.2)]);
    const context = frameContext({ time: 3 });
    context.camera.position.set(40, 2, 30);
    for (let i = 0; i < 400; i += 1) wash.update({ ...context, delta: 1 / 30 });
    const uniforms = wash.material.uniforms;
    expect(uniforms.uTime.value).toBe(3);
    expect(uniforms.uOffset.value.x).toBeCloseTo(40 * DEFAULT_WATERCOLOR.parallax, 6);
    expect(uniforms.uFocusAmount.value).toBeGreaterThan(0.8);
    expect((uniforms.uFocusColor.value as Color).r).toBeCloseTo(1, 2);
    expect(uniforms.uAspect.value).toBeCloseTo(1200 / 800, 5);
  });

  it('con movimiento reducido queda casi estático (sin tiempo, foco inmediato)', () => {
    const wash = new WatercolorWash([line('#00ff00', 1, true)]);
    wash.update(frameContext({ time: 9, reducedMotion: true }));
    expect(wash.material.uniforms.uTime.value).toBe(0);
    expect(wash.material.uniforms.uFocusAmount.value).toBeCloseTo(0.85, 5);
  });

  it('sin línea en esa X el tinte se apaga; attach no añade nada; dispose libera', () => {
    const wash = new WatercolorWash([]);
    const context = frameContext({ reducedMotion: true });
    context.camera.position.set(1e4, 0, 30);
    wash.update(context);
    expect(wash.material.uniforms.uFocusAmount.value).toBe(0);
    const scene = new Scene();
    wash.attach(scene);
    expect(scene.children).toEqual([]);
    const spy = vi.spyOn(wash.material, 'dispose');
    wash.dispose();
    expect(spy).toHaveBeenCalled();
  });
});

describe('WatercolorPass', () => {
  const fakeRenderer = () =>
    ({ setRenderTarget: vi.fn(), setClearColor: vi.fn(), clear: vi.fn(), render: vi.fn() }) as unknown as WebGLRenderer & {
      setRenderTarget: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      render: ReturnType<typeof vi.fn>;
    };
  const read = {} as WebGLRenderTarget;

  it('dibuja el lavado a resolución reducida y lo compone sobre el búfer de lectura (sin intercambio)', () => {
    const pass = new WatercolorPass(0.5);
    expect(pass.needsSwap).toBe(false);
    pass.setSize(1000, 600);
    pass.setWash(new WatercolorWash([line('#ff0000', 1, true)]));
    const renderer = fakeRenderer();
    pass.render(renderer, {} as WebGLRenderTarget, read);
    const targets = renderer.setRenderTarget.mock.calls.map((call) => call[0]);
    const low = targets[0] as WebGLRenderTarget;
    expect([low.width, low.height]).toEqual([500, 300]);
    expect(targets[1]).toBe(read);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.clear).not.toHaveBeenCalled();
  });

  it('sin lavado pinta el papel liso; renderToScreen dibuja en pantalla', () => {
    const pass = new WatercolorPass();
    pass.setWash(null);
    pass.renderToScreen = true;
    const renderer = fakeRenderer();
    pass.render(renderer, {} as WebGLRenderTarget, read);
    expect(renderer.clear).toHaveBeenCalled();
    expect(renderer.setRenderTarget.mock.calls.at(-1)?.[0]).toBeNull();
    expect(() => pass.dispose()).not.toThrow();
  });
});
