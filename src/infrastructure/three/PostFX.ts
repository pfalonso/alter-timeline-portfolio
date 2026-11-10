import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { damp } from './math';

export interface PostFxOptions {
  readonly strength: number;
  readonly radius: number;
  readonly threshold: number;
}

export const DEFAULT_POSTFX: PostFxOptions = { strength: 0.56, radius: 0.6, threshold: 0.18 };

/** Lo que la vista necesita del postprocesado (permite sustituirlo en tests). */
export interface PostProcessing {
  setSize(width: number, height: number, pixelRatio: number): void;
  render(delta: number): void;
  /** Sube el bloom un instante (pulso de selección). */
  kick(amount: number): void;
  dispose(): void;
}

/** EffectComposer + UnrealBloomPass + salida con tone mapping. */
export class PostFX implements PostProcessing {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private boost = 0;

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    private readonly options: PostFxOptions = DEFAULT_POSTFX,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), options.strength, options.radius, options.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  kick(amount: number): void {
    this.boost = Math.max(this.boost, amount);
  }

  render(delta: number): void {
    this.boost = damp(this.boost, 0, 3.2, delta);
    this.bloom.strength = this.options.strength + this.boost;
    this.composer.render(delta);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
