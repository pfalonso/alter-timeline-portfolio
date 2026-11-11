import type { PerspectiveCamera } from 'three';
import { clamp, damp, easeInOutCubic, pointOnRoute } from './math';

export interface RigBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface RigOptions {
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Inclinación (rad) desde la que la cámara mira la línea. */
  readonly pitch: number;
  /** Giro lateral (rad): da profundidad a las ramas. */
  readonly yaw: number;
  /** Rapidez de la amortiguación (mayor = más seca). */
  readonly damping: number;
  /** Cuánto desplaza la cámara el puntero (parallax), en fracción de la distancia. */
  readonly parallax: number;
}

export const DEFAULT_RIG_OPTIONS: RigOptions = {
  minDistance: 9,
  maxDistance: 260,
  pitch: 0.12,
  yaw: 0.1,
  damping: 3.2,
  parallax: 0.035,
};

interface RigPose {
  x: number;
  y: number;
  distance: number;
  /** Desplazamiento horizontal del encuadre en NDC (para dejar sitio al pop-up). */
  bias: number;
  pointerX: number;
  pointerY: number;
}

/** Vuelo guiado en curso (modo historia). */
interface Flight {
  readonly route: readonly { x: number; y: number }[];
  readonly duration: number;
  readonly distance: number;
  /** Cuánto se aleja la cámara a mitad de vuelo para dar contexto. */
  readonly lift: number;
  elapsed: number;
}

/**
 * Cámara "sobre raíles": un punto de interés sobre el plano de la línea temporal y una distancia.
 * Todo movimiento fija un objetivo y `update` lo persigue con amortiguación exponencial.
 */
export class CameraRig {
  private readonly options: RigOptions;
  private readonly pose: RigPose = { x: 0, y: 0, distance: 40, bias: 0, pointerX: 0, pointerY: 0 };
  private readonly goal: RigPose = { ...this.pose };
  private bounds: RigBounds = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
  private flight: Flight | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    options: Partial<RigOptions> = {},
  ) {
    this.options = { ...DEFAULT_RIG_OPTIONS, ...options };
  }

  get distance(): number {
    return this.pose.distance;
  }

  /** `true` mientras dura un vuelo guiado. */
  get flying(): boolean {
    return this.flight !== null;
  }

  /** X del mundo a la que mira la cámara (incluye el desplazamiento por el pop-up lateral). */
  get lookX(): number {
    return this.pose.x + this.pose.bias * this.halfHeightAt(this.pose.distance) * this.camera.aspect;
  }

  get target(): { x: number; y: number; distance: number } {
    return { x: this.goal.x, y: this.goal.y, distance: this.goal.distance };
  }

  setBounds(bounds: RigBounds): void {
    this.bounds = bounds;
    this.clampGoal();
  }

  /** Mitad del alto visible (en unidades de mundo) a una distancia dada. */
  halfHeightAt(distance: number): number {
    return distance * Math.tan((this.camera.fov * Math.PI) / 360);
  }

  /** Distancia a la que cabe un ancho de mundo dado. */
  distanceToFitWidth(width: number): number {
    return width / 2 / (Math.tan((this.camera.fov * Math.PI) / 360) * Math.max(0.2, this.camera.aspect));
  }

  /** Distancia a la que un alto de mundo dado ocupa la fracción `band` del alto de la ventana. */
  distanceToFitHeight(height: number, band = 1): number {
    return height / 2 / (Math.tan((this.camera.fov * Math.PI) / 360) * Math.max(0.05, band));
  }

  /** Arrastre: desplaza el punto de interés según píxeles de pantalla. */
  panByPixels(dx: number, dy: number, viewportHeight: number): void {
    this.flight = null;
    const worldPerPixel = (2 * this.halfHeightAt(this.goal.distance)) / Math.max(1, viewportHeight);
    this.goal.x -= dx * worldPerPixel;
    this.goal.y += dy * worldPerPixel;
    this.clampGoal();
  }

  zoomBy(factor: number): void {
    this.flight = null;
    this.goal.distance *= factor;
    this.clampGoal();
  }

  flyTo(point: { x: number; y: number }, distance?: number): void {
    this.flight = null;
    this.goal.x = point.x;
    this.goal.y = point.y;
    if (distance !== undefined) this.goal.distance = distance;
    this.clampGoal();
  }

  /**
   * Vuelo guiado por una ruta (modo historia): el punto de interés recorre `route` en `duration`
   * segundos con aceleración suave, alejándose `lift` a mitad de camino. Cualquier gesto lo corta.
   */
  flyAlong(route: readonly { x: number; y: number }[], distance: number, duration: number, lift = 0): void {
    if (route.length === 0) return;
    const end = route[route.length - 1];
    if (route.length === 1 || duration <= 0) {
      this.flyTo(end, distance);
      return;
    }
    this.flyTo(end, distance);
    this.flight = { route, duration, distance: this.goal.distance, lift, elapsed: 0 };
  }

  /** Traslada cámara y objetivo en X sin transición (re-layout: la escena se mueve bajo ella). */
  shiftX(dx: number): void {
    this.pose.x += dx;
    this.goal.x += dx;
    if (this.flight) this.flight = null;
    this.clampGoal();
    this.apply();
  }

  setDistance(distance: number): void {
    this.goal.distance = distance;
    this.clampGoal();
  }

  /** Coloca la cámara en el objetivo sin transición. */
  snap(): void {
    this.flight = null;
    Object.assign(this.pose, this.goal);
    this.apply();
  }

  setBias(ndc: number): void {
    this.goal.bias = ndc;
  }

  /** Posición del puntero normalizada a [-1, 1] para el parallax. */
  setPointer(x: number, y: number): void {
    this.goal.pointerX = clamp(x, -1, 1);
    this.goal.pointerY = clamp(y, -1, 1);
  }

  update(delta: number, reducedMotion = false): void {
    if (this.flight && reducedMotion) this.flight = null;
    if (this.flight) {
      // Durante el vuelo el punto de interés va sobre la ruta; la distancia se amortigua igual.
      const flight = this.flight;
      flight.elapsed += delta;
      const t = Math.min(1, flight.elapsed / flight.duration);
      const point = pointOnRoute(flight.route, easeInOutCubic(t));
      this.pose.x = clamp(point.x, this.bounds.minX, this.bounds.maxX);
      this.pose.y = clamp(point.y, this.bounds.minY, this.bounds.maxY);
      const k = this.options.damping;
      this.pose.distance = damp(this.pose.distance, flight.distance + flight.lift * Math.sin(Math.PI * t), k, delta);
      this.pose.bias = damp(this.pose.bias, this.goal.bias, k, delta);
      this.pose.pointerX = damp(this.pose.pointerX, this.goal.pointerX, 2, delta);
      this.pose.pointerY = damp(this.pose.pointerY, this.goal.pointerY, 2, delta);
      if (t >= 1) this.flight = null;
      this.apply();
      return;
    }
    if (reducedMotion) {
      // Sin vuelos ni parallax: corte directo al objetivo.
      Object.assign(this.pose, this.goal, { pointerX: 0, pointerY: 0 });
    } else {
      const k = this.options.damping;
      const p = this.pose;
      const g = this.goal;
      p.x = damp(p.x, g.x, k, delta);
      p.y = damp(p.y, g.y, k, delta);
      p.distance = damp(p.distance, g.distance, k * 0.85, delta);
      p.bias = damp(p.bias, g.bias, k, delta);
      p.pointerX = damp(p.pointerX, g.pointerX, 2, delta);
      p.pointerY = damp(p.pointerY, g.pointerY, 2, delta);
    }
    this.apply();
  }

  private clampGoal(): void {
    const g = this.goal;
    g.distance = clamp(g.distance, this.options.minDistance, this.options.maxDistance);
    g.x = clamp(g.x, this.bounds.minX, this.bounds.maxX);
    g.y = clamp(g.y, this.bounds.minY, this.bounds.maxY);
  }

  private apply(): void {
    const { pitch, yaw, parallax } = this.options;
    const p = this.pose;
    const lookX = this.lookX;
    const swayX = p.pointerX * parallax * p.distance;
    const swayY = -p.pointerY * parallax * p.distance;
    this.camera.position.set(
      lookX - Math.sin(yaw) * p.distance + swayX,
      p.y + Math.sin(pitch) * p.distance + swayY,
      Math.cos(yaw) * Math.cos(pitch) * p.distance,
    );
    this.camera.lookAt(lookX, p.y, 0);
  }
}
