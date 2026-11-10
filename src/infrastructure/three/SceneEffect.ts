import type { Scene } from 'three';
import type { FrameContext } from './types';

/**
 * Un efecto visual autónomo de la escena. Añadir un efecto nuevo = crear una clase que
 * implemente esta interfaz y registrarla en `SceneBuilder`; no hay que tocar la vista.
 */
export interface SceneEffect {
  attach(scene: Scene): void;
  update(frame: FrameContext): void;
  dispose(): void;
}
