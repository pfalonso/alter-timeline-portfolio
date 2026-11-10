import { PerspectiveCamera } from 'three';
import type { FrameContext } from '../../src/infrastructure/three/types';

/** Contexto de fotograma con una cámara real (no necesita WebGL). */
export function frameContext(overrides: Partial<FrameContext> = {}): FrameContext {
  const camera = overrides.camera ?? new PerspectiveCamera(38, 1.5, 0.5, 1600);
  if (!overrides.camera) camera.position.set(0, 0, 40);
  return { time: 0, delta: 1 / 60, camera, viewport: { width: 1200, height: 800 }, reducedMotion: false, ...overrides };
}

/** Planificador de fotogramas manual: `tick(ms)` ejecuta el callback pendiente. */
export class ManualScheduler {
  private next = 1;
  readonly pending = new Map<number, (timestampMs: number) => void>();
  readonly cancelled: number[] = [];

  request = (callback: (timestampMs: number) => void): number => {
    const handle = this.next;
    this.next += 1;
    this.pending.set(handle, callback);
    return handle;
  };

  cancel = (handle: number): void => {
    this.cancelled.push(handle);
    this.pending.delete(handle);
  };

  /** Ejecuta los callbacks pendientes (los que se pidan durante el tick quedan para el siguiente). */
  tick(timestampMs: number): number {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback(timestampMs);
    return callbacks.length;
  }
}

export class ManualVisibility {
  hidden = false;
  private readonly listeners: (() => void)[] = [];

  isHidden = (): boolean => this.hidden;

  onChange = (listener: () => void): void => {
    this.listeners.push(listener);
  };

  set(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
}
