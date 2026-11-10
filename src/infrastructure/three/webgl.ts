import { ACESFilmicToneMapping, WebGLRenderer, type Camera, type Scene } from 'three';
import { PostFX, type PostProcessing } from './PostFX';

/** Subconjunto del renderer que usa la vista (sustituible en tests). */
export interface RendererLike {
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  dispose(): void;
}

export interface RenderBackend {
  readonly renderer: RendererLike;
  createPostProcessing(scene: Scene, camera: Camera): PostProcessing;
}

export function isWebGLAvailable(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

/** Crea el renderer real; devuelve `null` si no hay WebGL2 (la app muestra el fallback en lista). */
export function createWebGLBackend(): RenderBackend | null {
  if (!isWebGLAvailable()) return null;
  try {
    const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    return {
      renderer,
      createPostProcessing: (scene, camera) => new PostFX(renderer, scene, camera),
    };
  } catch {
    return null;
  }
}
