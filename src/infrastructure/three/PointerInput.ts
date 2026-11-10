export interface PointerInputHandlers {
  /** Arrastre con un puntero (píxeles desde el evento anterior). */
  onDrag(dx: number, dy: number): void;
  /** Desplazamiento con rueda/trackpad (píxeles). */
  onScroll(dx: number, dy: number): void;
  /** Factor multiplicativo de distancia (<1 acerca). */
  onZoom(factor: number): void;
  /** Puntero en reposo sobre la escena; `null` al salir. */
  onHover(point: { x: number; y: number } | null): void;
  /** Clic / toque sin arrastre. */
  onTap(point: { x: number; y: number }): void;
}

const TAP_SLOP = 6;

/** Traduce eventos de puntero, rueda y gestos táctiles (arrastre, pellizco) a intenciones. */
export class PointerInput {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private travelled = 0;
  private pinchDistance = 0;
  private readonly abort = new AbortController();

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: PointerInputHandlers,
  ) {
    const options = { signal: this.abort.signal };
    element.addEventListener('pointerdown', (event) => this.onDown(event), options);
    element.addEventListener('pointermove', (event) => this.onMove(event), options);
    element.addEventListener('pointerup', (event) => this.onUp(event), options);
    element.addEventListener('pointercancel', (event) => this.onCancel(event), options);
    element.addEventListener('pointerleave', () => this.handlers.onHover(null), options);
    element.addEventListener('wheel', (event) => this.onWheel(event), { ...options, passive: false });
  }

  get dragging(): boolean {
    return this.pointers.size > 0 && this.travelled > TAP_SLOP;
  }

  dispose(): void {
    this.abort.abort();
  }

  private local(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) this.travelled = 0;
    if (this.pointers.size === 2) {
      this.pinchDistance = this.currentPinch();
      this.travelled = Infinity; // un pellizco nunca es un toque
    }
    this.element.setPointerCapture?.(event.pointerId);
  }

  private onMove(event: PointerEvent): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType !== 'touch') this.handlers.onHover(this.local(event));
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    previous.x = event.clientX;
    previous.y = event.clientY;

    if (this.pointers.size >= 2) {
      const distance = this.currentPinch();
      if (this.pinchDistance > 0 && distance > 0) this.handlers.onZoom(this.pinchDistance / distance);
      this.pinchDistance = distance;
      return;
    }
    this.travelled += Math.abs(dx) + Math.abs(dy);
    if (this.travelled > TAP_SLOP) {
      this.handlers.onHover(null);
      this.handlers.onDrag(dx, dy);
    }
  }

  private onUp(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) return;
    this.element.releasePointerCapture?.(event.pointerId);
    if (this.pointers.size === 0 && this.travelled <= TAP_SLOP) this.handlers.onTap(this.local(event));
    if (this.pointers.size < 2) this.pinchDistance = 0;
  }

  private onCancel(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    this.pinchDistance = 0;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 600 : 1;
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+rueda (o pellizco de trackpad) = zoom.
      this.handlers.onZoom(Math.exp(Math.max(-60, Math.min(60, event.deltaY * unit)) * 0.012));
      return;
    }
    this.handlers.onScroll(event.deltaX * unit, event.deltaY * unit);
  }

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
