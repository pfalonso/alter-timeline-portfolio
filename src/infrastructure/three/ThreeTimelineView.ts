import { FogExp2, PerspectiveCamera, Scene, Vector3 } from 'three';
import type {
  FilterViewState,
  SelectionViewState,
  TimelineViewHandlers,
  TimelineViewModel,
} from '../../application/ports';
import type { TimelineLayoutResult } from '../../domain/services';
import type { TimelineViewPart } from '../dom/CompositeTimelineView';
import type { NodeHoverListener } from '../dom/Tooltip';
import { CameraRig } from './CameraRig';
import { activeArcAt } from './ArcBands';
import { bandFraction, bandOffset, clamp, pickNode, storyRoute, verticalExtent, type SafeInsets } from './math';
import type { NodeMesh } from './NodeMesh';
import { PointerInput } from './PointerInput';
import type { PostProcessing } from './PostFX';
import type { RenderLoop } from './RenderLoop';
import { DEFAULT_PALETTE, type BuiltScene, type SceneBuilder } from './SceneBuilder';
import type {
  CameraControls,
  FrameContext,
  ProjectedFrame,
  ProjectedNode,
  ProjectionListener,
  Viewport,
} from './types';
import type { RenderBackend } from './webgl';

export interface ThreeTimelineViewDeps {
  /** Contenedor de la escena: el canvas se inserta aquí y ocupa todo su tamaño. */
  readonly container: HTMLElement;
  readonly backend: RenderBackend;
  readonly sceneBuilder: SceneBuilder;
  readonly loop: RenderLoop;
  readonly reducedMotion: () => boolean;
  readonly hoverListener?: NodeHoverListener;
  readonly projectionListeners?: readonly ProjectionListener[];
  readonly maxPixelRatio?: number;
  readonly devicePixelRatio?: () => number;
  /** Franjas (px) tapadas por la cabecera/controles y por filtros/regla; por defecto, ninguna. */
  readonly safeInsets?: () => SafeInsets;
}

const DEFAULT_DISTANCE = 44;
/** Tope de la vista general: vidas largas (desde el nacimiento) necesitan alejarse más. */
const OVERVIEW_MAX_DISTANCE = 160;
const FOG_DENSITY = 0.0068;
/** Más allá de esta distancia la niebla se aclara en proporción, para que lo lejano no se apague. */
const FOG_REFERENCE_DISTANCE = 90;
/** Tope del alejamiento inicial: más lejos, los nodos se vuelven demasiado pequeños. */
const OPENING_MAX_DISTANCE = 80;
/** Margen vertical (mundo) alrededor de las ramas al encuadrar: radio de los nodos y halos. */
const FRAME_MARGIN = 2.2;
const DETAIL_DISTANCE = 21;
/** Margen vertical (mundo) que se encuadra alrededor de la banda de nodos al abrir. */
const BAND_FRAME = 4.5;
/** Por encima de este ancho el pop-up es un panel lateral y el encuadre se desplaza. */
const SIDE_PANEL_MIN_WIDTH = 900;

/** Vista 3D: compone escena, cámara, entrada y postprocesado. La lógica vive en piezas pequeñas. */
export class ThreeTimelineView implements TimelineViewPart, CameraControls {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(38, 1, 0.5, 1600);
  private readonly rig = new CameraRig(this.camera);
  private readonly post: PostProcessing;
  private readonly scratch = new Vector3();
  private viewport: Viewport = { width: 1, height: 1 };

  private handlers: TimelineViewHandlers | null = null;
  private built: BuiltScene | null = null;
  private layout: TimelineLayoutResult | null = null;
  private readonly nodesById = new Map<string, NodeMesh>();
  private projected: ProjectedFrame | null = null;
  private hoveredId: string | null = null;
  private focusedId: string | null = null;
  private pointer: { x: number; y: number } | null = null;
  private detailOpen = false;
  private overviewDistance = 80;
  private distanceBeforeDetail: number | null = null;
  private highlightedBranch: string | null = null;

  constructor(private readonly deps: ThreeTimelineViewDeps) {
    const canvas = deps.backend.renderer.domElement;
    canvas.classList.add('stage__canvas');
    deps.container.prepend(canvas);
    // Sin fondo de escena: el papel de acuarela lo pinta el postprocesado antes que ella.
    this.scene.background = null;
    this.post = deps.backend.createPostProcessing(this.scene, this.camera);

    new PointerInput(canvas, {
      onDrag: (dx, dy) => this.rig.panByPixels(dx, dy, this.viewport.height),
      onScroll: (dx, dy) => this.rig.panByPixels(-(dx + dy) * 0.9, 0, this.viewport.height),
      onZoom: (factor) => this.rig.zoomBy(factor),
      onHover: (point) => {
        this.pointer = point;
        if (point) {
          this.rig.setPointer((point.x / this.viewport.width) * 2 - 1, (point.y / this.viewport.height) * 2 - 1);
        }
      },
      onTap: (point) => this.onTap(point),
    });

    new ResizeObserver(() => this.resize()).observe(deps.container);
    this.resize();
  }

  bind(handlers: TimelineViewHandlers): void {
    this.handlers = handlers;
  }

  render(model: TimelineViewModel): void {
    this.built?.dispose();
    this.nodesById.clear();
    this.layout = model.layout;

    const built = this.deps.sceneBuilder.build(model);
    this.built = built;
    this.scene.fog = new FogExp2(DEFAULT_PALETTE.background, FOG_DENSITY);
    for (const effect of built.effects) effect.attach(this.scene);
    this.post.setBackdrop?.(built.backdrop);
    if (this.highlightedBranch !== null) built.highlightBranch(this.highlightedBranch);
    for (const node of built.nodes) {
      this.scene.add(node.group);
      this.nodesById.set(node.eventId, node);
    }

    const { bounds, nowX } = model.layout;
    const insets = this.insets();
    const band = bandFraction(this.viewport.height, insets);
    // Vista general: cabe todo el ancho y todo el alto (más margen) dentro de la franja libre.
    this.overviewDistance = Math.min(
      OVERVIEW_MAX_DISTANCE,
      Math.max(
        this.rig.distanceToFitWidth(bounds.maxX - bounds.minX) * 1.1,
        this.rig.distanceToFitHeight(bounds.maxY - bounds.minY + 2 * FRAME_MARGIN, band),
      ),
    );
    // El encuadre desplaza la cámara para centrar en la franja libre: los límites admiten ese margen.
    const shift = Math.abs(bandOffset(this.viewport.height, insets)) * 2 * this.rig.halfHeightAt(this.overviewDistance);
    this.rig.setBounds({ minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY - 2 - shift, maxY: bounds.maxY + 2 + shift });

    // Apertura: de la vista general al presente.
    this.rig.flyTo(this.overviewTarget(), this.overviewDistance);
    this.rig.snap();
    const opening = this.openingView(model.layout, nowX);
    this.rig.flyTo(opening, opening.distance);
    if (this.deps.reducedMotion()) this.rig.snap();

    this.deps.loop.start((delta, time) => this.frame(delta, time));
  }

  /** Resalta una línea vital en la escena (p. ej. al pasar por la leyenda); `null` la suelta. */
  highlightBranch(id: string | null): void {
    this.highlightedBranch = id;
    this.built?.highlightBranch(id);
  }

  applyFilter(state: FilterViewState): void {
    for (const node of this.nodesById.values()) node.setVisible(state.visibleEventIds.has(node.eventId));
  }

  applySelection(state: SelectionViewState): void {
    const changed = state.focusedEventId !== this.focusedId;
    const opened = state.detailOpen && !this.detailOpen;
    const closed = !state.detailOpen && this.detailOpen;
    this.detailOpen = state.detailOpen;
    if (opened) this.distanceBeforeDetail = this.rig.target.distance;
    if (closed && this.distanceBeforeDetail !== null) {
      // Al cerrar el detalle la cámara recupera la distancia que tenía.
      this.rig.setDistance(Math.max(this.distanceBeforeDetail, DETAIL_DISTANCE * 1.5));
      this.distanceBeforeDetail = null;
    }
    this.nodesById.get(this.focusedId ?? '')?.setFocused(false);
    this.focusedId = state.focusedEventId;
    const node = this.nodesById.get(state.focusedEventId ?? '');
    node?.setFocused(true);

    const sidePanel = state.detailOpen && this.viewport.width >= SIDE_PANEL_MIN_WIDTH;
    this.rig.setBias(sidePanel ? 0.34 : 0);
    if (!node || (!changed && !opened)) return;

    // Vuelo de cámara + pulso: el momento de la selección. En la historia, el vuelo sigue las líneas.
    const distance = state.detailOpen ? DETAIL_DISTANCE : Math.min(this.rig.target.distance, this.defaultDistance());
    const from = state.story?.fromEventId ? this.nodesById.get(state.story.fromEventId) : undefined;
    if (from && from !== node && !this.deps.reducedMotion()) this.flyAlongLines(from, node, distance);
    else this.rig.flyTo(node.group.position, distance);
    this.built?.pulse.trigger(node.group.position, node.color, node.radius);
    if (!this.deps.reducedMotion()) this.post.kick(state.detailOpen ? 0.9 : 0.45);
  }

  /** Vuelo del modo historia: avanza por el tiempo siguiendo la línea de salida y la de llegada. */
  private flyAlongLines(from: NodeMesh, to: NodeMesh, distance: number): void {
    const lineOf = (id: string) => {
      const branch = this.layout?.nodes.find((item) => item.eventId === id)?.branch;
      return this.layout?.branches.find((item) => item.id === branch)?.points;
    };
    const a = from.group.position;
    const b = to.group.position;
    const route = storyRoute(a, b, lineOf(from.eventId), lineOf(to.eventId));
    const span = Math.abs(b.x - a.x);
    this.rig.flyAlong(route, distance, clamp(1.3 + span / 30, 1.5, 3.4), Math.min(26, 4 + span * 0.35));
  }

  zoomBy(factor: number): void {
    this.rig.zoomBy(factor);
  }

  showOverview(): void {
    if (!this.layout) return;
    this.rig.flyTo(this.overviewTarget(), this.overviewDistance);
  }

  /** Coordenadas de pantalla (píxeles CSS de la ventana) de cada nodo; para depuración y tests E2E. */
  getNodeScreenPositions(): { id: string; x: number; y: number; visible: boolean }[] {
    const rect = this.deps.backend.renderer.domElement.getBoundingClientRect();
    return (this.projected?.nodes ?? []).map((node) => ({
      id: node.eventId,
      x: Math.round(rect.left + node.x),
      y: Math.round(rect.top + node.y),
      visible:
        node.inFront &&
        node.presence >= 0.5 &&
        node.x >= 0 &&
        node.y >= 0 &&
        node.x <= this.viewport.width &&
        node.y <= this.viewport.height,
    }));
  }

  private insets(): SafeInsets {
    return this.deps.safeInsets?.() ?? { top: 0, bottom: 0 };
  }

  /** Y de cámara que deja `centerY` en el centro de la franja libre a una distancia dada. */
  private bandCenterY(centerY: number, distance: number): number {
    const offset = bandOffset(this.viewport.height, this.insets());
    return centerY - offset * 2 * this.rig.halfHeightAt(distance);
  }

  private overviewTarget(): { x: number; y: number } {
    const { bounds } = this.layout as TimelineLayoutResult;
    return { x: (bounds.minX + bounds.maxX) / 2, y: this.bandCenterY((bounds.minY + bounds.maxY) / 2, this.overviewDistance) };
  }

  /**
   * Encuadre inicial cerca de hoy: «hoy» queda a la derecha y la cámara se aleja lo justo para que
   * las ramas visibles quepan en vertical entre la cabecera y los filtros.
   */
  private openingView(layout: TimelineLayoutResult, nowX: number): { x: number; y: number; distance: number } {
    const band = bandFraction(this.viewport.height, this.insets());
    let distance = this.defaultDistance();
    let extent = { minY: layout.bounds.minY, maxY: layout.bounds.maxY };
    // Dos pasadas: la distancia cambia el ancho visible y con él qué ramas entran en cuadro.
    for (let pass = 0; pass < 2; pass += 1) {
      const halfWidth = this.rig.halfHeightAt(distance) * this.camera.aspect;
      const x = nowX - halfWidth * 0.7;
      extent = verticalExtent(layout.branches, x - halfWidth, x + halfWidth) ?? extent;
      // Lo que importa es la banda de los nodos: las hebras que se alejan pueden perderse por arriba/abajo.
      if (layout.band) {
        extent = {
          minY: Math.max(extent.minY, layout.band.minY - BAND_FRAME),
          maxY: Math.min(extent.maxY, layout.band.maxY + BAND_FRAME),
        };
      }
      distance = Math.min(
        OPENING_MAX_DISTANCE,
        Math.max(this.defaultDistance(), this.rig.distanceToFitHeight(extent.maxY - extent.minY + 2 * FRAME_MARGIN, band)),
      );
    }
    const halfWidth = this.rig.halfHeightAt(distance) * this.camera.aspect;
    return { x: nowX - halfWidth * 0.7, y: this.bandCenterY((extent.minY + extent.maxY) / 2, distance), distance };
  }

  /** En pantallas estrechas la cámara se aleja para que quepan varios años. */
  private defaultDistance(): number {
    return DEFAULT_DISTANCE * Math.min(1.7, Math.max(1, 1.25 / this.camera.aspect));
  }

  private onTap(point: { x: number; y: number }): void {
    const id = this.projected ? pickNode(this.projected.nodes, point.x, point.y) : null;
    if (id !== null) this.handlers?.onEventActivated(id);
    else if (this.detailOpen) this.handlers?.onDetailClosed();
    else this.handlers?.onSelectionCleared();
  }

  private resize(): void {
    const width = Math.max(1, this.deps.container.clientWidth);
    const height = Math.max(1, this.deps.container.clientHeight);
    const ratio = Math.min(this.deps.maxPixelRatio ?? 2, (this.deps.devicePixelRatio ?? (() => window.devicePixelRatio || 1))());
    this.viewport = { width, height };
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.deps.backend.renderer.setPixelRatio(ratio);
    this.deps.backend.renderer.setSize(width, height, false);
    this.post.setSize(width, height, ratio);
  }

  private frame(delta: number, time: number): void {
    if (!this.built) return;
    const reducedMotion = this.deps.reducedMotion();
    this.rig.update(delta, reducedMotion);
    this.camera.updateMatrixWorld();
    this.built.arcs.setActive(this.layout ? activeArcAt(this.layout.arcs, this.rig.lookX) : null);
    const fogDensity = FOG_DENSITY * Math.min(1, FOG_REFERENCE_DISTANCE / Math.max(1, this.rig.distance));
    if (this.scene.fog instanceof FogExp2) this.scene.fog.density = fogDensity;
    const context: FrameContext = { time, delta, camera: this.camera, viewport: this.viewport, reducedMotion, fogDensity };
    for (const effect of this.built.effects) effect.update(context);
    for (const node of this.built.nodes) node.update(context);

    this.projected = this.project();
    this.updateHover();
    for (const listener of this.deps.projectionListeners ?? []) listener.onProjected(this.projected);
    this.post.render(delta);
  }

  private project(): ProjectedFrame {
    const { width, height } = this.viewport;
    const pixelsPerUnitAtOne = height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    const toScreen = (x: number, y: number, z: number): { x: number; y: number; inFront: boolean; depth: number } => {
      const v = this.scratch.set(x, y, z);
      const depth = v.distanceTo(this.camera.position);
      v.project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, inFront: v.z > -1 && v.z < 1, depth };
    };
    const nodes: ProjectedNode[] = (this.built?.nodes ?? []).map((node) => {
      const p = node.group.position;
      const screen = toScreen(p.x, p.y, p.z);
      return {
        eventId: node.eventId,
        x: screen.x,
        y: screen.y,
        inFront: screen.inFront,
        radius: (node.radius * node.scale * pixelsPerUnitAtOne) / Math.max(0.001, screen.depth),
        presence: node.presence,
        importance: node.importance,
        highlighted: node.highlighted,
      };
    });
    const years = (this.layout?.years ?? []).map((mark) => {
      const screen = toScreen(mark.x, 0, 0);
      return { year: mark.year, x: screen.x, inFront: screen.inFront };
    });
    const now = this.layout ? toScreen(this.layout.nowX, 0, 0) : null;
    const active = this.built?.arcs.active ?? null;
    // Un extremo detrás de la cámara se proyecta «reflejado»: se manda fuera de pantalla por su lado.
    const lookX = this.rig.lookX;
    const screenX = (x: number): number => {
      const p = toScreen(x, 0, 0);
      return p.inFront ? p.x : x < lookX ? -1e5 : 1e5;
    };
    const arcs = (this.layout?.arcs ?? []).map((arc) => ({
      id: arc.id,
      startX: screenX(arc.startX),
      endX: screenX(arc.endX),
      active: arc.id === active,
    }));
    return {
      nodes,
      years,
      nowX: now && now.inFront ? now.x : null,
      cameraDistance: this.rig.distance,
      viewport: this.viewport,
      arcs,
    };
  }

  private updateHover(): void {
    const canvas = this.deps.backend.renderer.domElement;
    const id = this.pointer && this.projected ? pickNode(this.projected.nodes, this.pointer.x, this.pointer.y) : null;
    if (id !== this.hoveredId) {
      this.nodesById.get(this.hoveredId ?? '')?.setHovered(false);
      this.nodesById.get(id ?? '')?.setHovered(true);
      this.hoveredId = id;
      canvas.classList.toggle('stage__canvas--pointing', id !== null);
    }
    const rect = canvas.getBoundingClientRect();
    const node = id === null ? undefined : this.projected?.nodes.find((item) => item.eventId === id);
    this.deps.hoverListener?.onNodeHover(node ? id : null, {
      x: rect.left + (node?.x ?? 0),
      y: rect.top + (node?.y ?? 0) - (node?.radius ?? 0) - 14,
    });
  }
}
