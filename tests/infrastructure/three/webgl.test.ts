import type * as Three from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `webgl.ts` y `PostFX.ts` son el único código que exige WebGL real. Aquí se sustituyen el
 * renderer de three y las pasadas de postprocesado por dobles para ejercitar su lógica propia
 * (detección de soporte, configuración, golpe de bloom) sin GPU.
 */
const mocks = vi.hoisted(() => {
  const state = { rendererThrows: false, renderers: [] as Record<string, unknown>[], composers: [] as Record<string, unknown>[] };
  class FakeRenderer {
    readonly domElement = { tagName: 'CANVAS' };
    toneMapping = -1;
    toneMappingExposure = 0;
    readonly setPixelRatio = vi.fn();
    readonly setSize = vi.fn();
    readonly dispose = vi.fn();
    constructor(readonly parameters: Record<string, unknown>) {
      if (state.rendererThrows) throw new Error('Error creating WebGL context');
      state.renderers.push(this as unknown as Record<string, unknown>);
    }
  }
  class FakeComposer {
    readonly passes: unknown[] = [];
    readonly setPixelRatio = vi.fn();
    readonly setSize = vi.fn();
    readonly render = vi.fn();
    readonly dispose = vi.fn();
    constructor(readonly renderer: unknown) {
      state.composers.push(this as unknown as Record<string, unknown>);
    }
    addPass(pass: unknown): void {
      this.passes.push(pass);
    }
  }
  class FakeRenderPass {
    readonly kind = 'render';
    constructor(
      readonly scene: unknown,
      readonly camera: unknown,
    ) {}
  }
  class FakeBloomPass {
    readonly kind = 'bloom';
    constructor(
      readonly resolution: unknown,
      public strength: number,
      readonly radius: number,
      readonly threshold: number,
    ) {}
  }
  class FakeOutputPass {
    readonly kind = 'output';
  }
  return { state, FakeRenderer, FakeComposer, FakeRenderPass, FakeBloomPass, FakeOutputPass };
});

vi.mock('three', async (importOriginal) => ({ ...(await importOriginal<typeof Three>()), WebGLRenderer: mocks.FakeRenderer }));
vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({ EffectComposer: mocks.FakeComposer }));
vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({ RenderPass: mocks.FakeRenderPass }));
vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({ UnrealBloomPass: mocks.FakeBloomPass }));
vi.mock('three/examples/jsm/postprocessing/OutputPass.js', () => ({ OutputPass: mocks.FakeOutputPass }));

import { ACESFilmicToneMapping, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { DEFAULT_POSTFX, PostFX } from '../../../src/infrastructure/three/PostFX';
import { createWebGLBackend, isWebGLAvailable } from '../../../src/infrastructure/three/webgl';

type FakeComposer = InstanceType<typeof mocks.FakeComposer>;
type FakeBloom = InstanceType<typeof mocks.FakeBloomPass>;

/** Hace que `canvas.getContext('webgl2')` devuelva (o no) un contexto en jsdom. */
function stubWebGL2(available: boolean | 'throws'): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => {
    if (available === 'throws') throw new Error('getContext roto');
    return available && type === 'webgl2' ? {} : null;
  }) as never);
}

afterEach(() => {
  mocks.state.rendererThrows = false;
  mocks.state.renderers.length = 0;
  mocks.state.composers.length = 0;
});

describe('isWebGLAvailable', () => {
  it('true solo si el canvas da un contexto webgl2', () => {
    const doc = (context: unknown): Document =>
      ({ createElement: () => ({ getContext: (type: string) => (type === 'webgl2' ? context : null) }) }) as unknown as Document;
    expect(isWebGLAvailable(doc({}))).toBe(true);
    expect(isWebGLAvailable(doc(null))).toBe(false);
    expect(isWebGLAvailable(doc(undefined))).toBe(false);
  });

  it('false si crear el canvas o pedir el contexto lanza', () => {
    const throwing = {
      createElement: () => {
        throw new Error('sin canvas');
      },
    } as unknown as Document;
    expect(isWebGLAvailable(throwing)).toBe(false);
  });

  it('por defecto consulta el document real', () => {
    stubWebGL2(false);
    expect(isWebGLAvailable()).toBe(false);
    stubWebGL2(true);
    expect(isWebGLAvailable()).toBe(true);
    stubWebGL2('throws');
    expect(isWebGLAvailable()).toBe(false);
  });
});

describe('createWebGLBackend', () => {
  it('sin WebGL2 devuelve null (la app muestra la lista) y no intenta crear el renderer', () => {
    stubWebGL2(false);
    expect(createWebGLBackend()).toBeNull();
    expect(mocks.state.renderers).toHaveLength(0);
  });

  it('si el renderer falla al crearse (GPU bloqueada, contexto perdido) devuelve null', () => {
    stubWebGL2(true);
    mocks.state.rendererThrows = true;
    expect(createWebGLBackend()).toBeNull();
  });

  it('con WebGL2 crea el renderer con tone mapping fílmico y sin antialias (lo suple el bloom)', () => {
    stubWebGL2(true);
    const backend = createWebGLBackend();
    expect(backend).not.toBeNull();
    expect(mocks.state.renderers).toHaveLength(1);
    const renderer = mocks.state.renderers[0];
    expect(backend?.renderer).toBe(renderer);
    expect(renderer.parameters).toEqual({ antialias: false, powerPreference: 'high-performance', alpha: false });
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeGreaterThan(1);
  });

  it('createPostProcessing construye la cadena de postprocesado sobre ese renderer', () => {
    stubWebGL2(true);
    const backend = createWebGLBackend();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const post = backend?.createPostProcessing(scene, camera);
    expect(post).toBeInstanceOf(PostFX);
    const composer = mocks.state.composers[0] as unknown as FakeComposer;
    expect(composer.renderer).toBe(mocks.state.renderers[0]);
    expect((composer.passes[0] as { scene: unknown }).scene).toBe(scene);
    expect((composer.passes[0] as { camera: unknown }).camera).toBe(camera);
  });
});

describe('PostFX', () => {
  function setup(options = DEFAULT_POSTFX): { post: PostFX; composer: FakeComposer; bloom: FakeBloom } {
    const post = new PostFX({} as WebGLRenderer, new Scene(), new PerspectiveCamera(), options);
    const composer = mocks.state.composers.at(-1) as unknown as FakeComposer;
    return { post, composer, bloom: composer.passes[1] as FakeBloom };
  }

  it('encadena render → bloom → salida, con los parámetros de bloom configurados', () => {
    const { composer, bloom } = setup({ strength: 0.7, radius: 0.4, threshold: 0.2 });
    expect(composer.passes.map((pass) => (pass as { kind: string }).kind)).toEqual(['render', 'bloom', 'output']);
    expect(bloom).toMatchObject({ strength: 0.7, radius: 0.4, threshold: 0.2 });
  });

  it('setSize propaga tamaño y pixelRatio al compositor', () => {
    const { post, composer } = setup();
    post.setSize(1200, 800, 2);
    expect(composer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(composer.setSize).toHaveBeenCalledWith(1200, 800);
  });

  it('render dibuja con el delta y, en reposo, mantiene la intensidad base del bloom', () => {
    const { post, composer, bloom } = setup();
    post.render(0.016);
    expect(composer.render).toHaveBeenCalledExactlyOnceWith(0.016);
    expect(bloom.strength).toBe(DEFAULT_POSTFX.strength);
  });

  it('kick sube el bloom un instante y decae hasta la intensidad base', () => {
    const { post, bloom } = setup();
    post.kick(0.9);
    post.render(0);
    expect(bloom.strength).toBeCloseTo(DEFAULT_POSTFX.strength + 0.9, 10);
    let previous = bloom.strength;
    for (let i = 0; i < 30; i += 1) {
      post.render(1 / 60);
      expect(bloom.strength).toBeLessThan(previous);
      expect(bloom.strength).toBeGreaterThan(DEFAULT_POSTFX.strength);
      previous = bloom.strength;
    }
    for (let i = 0; i < 600; i += 1) post.render(1 / 60);
    expect(bloom.strength).toBeCloseTo(DEFAULT_POSTFX.strength, 6);
  });

  it('un golpe menor no rebaja uno mayor en curso', () => {
    const { post, bloom } = setup();
    post.kick(0.9);
    post.kick(0.45);
    post.render(0);
    expect(bloom.strength).toBeCloseTo(DEFAULT_POSTFX.strength + 0.9, 10);
  });

  it('dispose libera el compositor', () => {
    const { post, composer } = setup();
    post.dispose();
    expect(composer.dispose).toHaveBeenCalledTimes(1);
  });
});
