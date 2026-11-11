import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { damp } from './math';
import { WatercolorPass, type WatercolorWash } from './Watercolor';

export interface PostFxOptions {
  readonly strength: number;
  readonly radius: number;
  readonly threshold: number;
}

/** Bloom contenido: tinta luminosa más que neón (el umbral deja fuera el papel y los lavados). */
export const DEFAULT_POSTFX: PostFxOptions = { strength: 0.36, radius: 0.42, threshold: 0.38 };
/** Golpe máximo de bloom al seleccionar. */
export const MAX_KICK = 0.14;

/** Lo que la vista necesita del postprocesado (permite sustituirlo en tests). */
export interface PostProcessing {
  setSize(width: number, height: number, pixelRatio: number): void;
  render(delta: number): void;
  /** Sube el bloom un instante (pulso de selección). */
  kick(amount: number): void;
  /** Fondo de acuarela que se dibuja antes que la escena (`null` = papel liso). */
  setBackdrop?(wash: WatercolorWash | null): void;
  dispose(): void;
}

/** Fondo de acuarela + EffectComposer + UnrealBloomPass + salida con tone mapping. */
export class PostFX implements PostProcessing {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly backdrop = new WatercolorPass(0.5);
  private boost = 0;

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    private readonly options: PostFxOptions = DEFAULT_POSTFX,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(this.backdrop);
    // La escena se pinta encima del papel: no borra el color, solo la profundidad.
    const scenePass = new RenderPass(scene, camera);
    scenePass.clear = false;
    scenePass.clearDepth = true;
    this.composer.addPass(scenePass);
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), options.strength, options.radius, options.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  setBackdrop(wash: WatercolorWash | null): void {
    this.backdrop.setWash(wash);
  }

  kick(amount: number): void {
    // Tope del golpe de selección: sumado a remolinos o costuras cercanas, más quemaba la imagen.
    this.boost = Math.min(MAX_KICK, Math.max(this.boost, amount));
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
