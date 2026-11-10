export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

export interface VisibilitySource {
  isHidden(): boolean;
  onChange(listener: () => void): void;
}

export const browserScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export const documentVisibility: VisibilitySource = {
  isHidden: () => document.hidden,
  onChange: (listener) => document.addEventListener('visibilitychange', listener),
};

export type Tick = (deltaSeconds: number, elapsedSeconds: number) => void;

/** Bucle de render que se detiene con la pestaña oculta y acota el delta al volver. */
export class RenderLoop {
  private handle: number | null = null;
  private last: number | null = null;
  private elapsed = 0;
  private tick: Tick | null = null;
  private wanted = false;

  constructor(
    private readonly scheduler: FrameScheduler = browserScheduler,
    private readonly visibility: VisibilitySource = documentVisibility,
    private readonly maxDelta = 0.1,
  ) {
    this.visibility.onChange(() => this.sync());
  }

  get running(): boolean {
    return this.handle !== null;
  }

  start(tick: Tick): void {
    this.tick = tick;
    this.wanted = true;
    this.sync();
  }

  stop(): void {
    this.wanted = false;
    this.sync();
  }

  private sync(): void {
    const shouldRun = this.wanted && !this.visibility.isHidden();
    if (shouldRun && this.handle === null) {
      this.last = null;
      this.handle = this.scheduler.request(this.frame);
    } else if (!shouldRun && this.handle !== null) {
      this.scheduler.cancel(this.handle);
      this.handle = null;
    }
  }

  private readonly frame = (timestampMs: number): void => {
    if (this.handle === null) return;
    const delta = this.last === null ? 0 : Math.min(this.maxDelta, Math.max(0, (timestampMs - this.last) / 1000));
    this.last = timestampMs;
    this.elapsed += delta;
    this.handle = this.scheduler.request(this.frame);
    this.tick?.(delta, this.elapsed);
  };
}
