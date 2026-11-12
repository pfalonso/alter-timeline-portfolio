import type { PerspectiveCamera } from 'three';

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Contexto que recibe cada efecto en cada fotograma. */
export interface FrameContext {
  /** Segundos desde que arrancó la escena. */
  readonly time: number;
  /** Segundos desde el fotograma anterior (acotado). */
  readonly delta: number;
  readonly camera: PerspectiveCamera;
  readonly viewport: Viewport;
  readonly reducedMotion: boolean;
  /** Densidad de niebla vigente (se aclara al alejarse para que la vista general no se apague). */
  readonly fogDensity?: number;
}

export interface ProjectedNode {
  readonly eventId: string;
  /** Posición en píxeles CSS relativa a la escena. */
  readonly x: number;
  readonly y: number;
  /** Radio aparente del núcleo en píxeles. */
  readonly radius: number;
  /** 0 = filtrado (atenuado) … 1 = plenamente visible. */
  readonly presence: number;
  readonly importance: number;
  readonly inFront: boolean;
  readonly highlighted: boolean;
}

export interface ProjectedYear {
  readonly year: number;
  readonly x: number;
  readonly inFront: boolean;
}

/** Capítulo proyectado: X en pantalla de su inicio y su fin; `active` si la cámara está dentro. */
export interface ProjectedArc {
  readonly id: string;
  readonly startX: number;
  readonly endX: number;
  readonly active: boolean;
}

export interface ProjectedFrame {
  readonly nodes: readonly ProjectedNode[];
  readonly years: readonly ProjectedYear[];
  /** X en pantalla de "hoy". */
  readonly nowX: number | null;
  readonly cameraDistance: number;
  readonly viewport: Viewport;
  /** Arcos temporales (si los datos los declaran). */
  readonly arcs?: readonly ProjectedArc[];
  /** X de mundo al que mira la cámara (centro de la zona visible). */
  readonly lookX?: number;
}

/** Capas DOM que se colocan siguiendo la proyección de la escena (etiquetas, regla de años). */
export interface ProjectionListener {
  onProjected(frame: ProjectedFrame): void;
}

/** Controles de cámara que la interfaz puede accionar con botones. */
export interface CameraControls {
  zoomBy(factor: number): void;
  showOverview(): void;
}
