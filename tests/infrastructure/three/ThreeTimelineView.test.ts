import type { Camera, FogExp2, Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineViewModel } from '../../../src/application/ports';
import type { NodeHoverListener } from '../../../src/infrastructure/dom/Tooltip';
import type { PostProcessing } from '../../../src/infrastructure/three/PostFX';
import { RenderLoop } from '../../../src/infrastructure/three/RenderLoop';
import { SceneBuilder, type BuiltScene } from '../../../src/infrastructure/three/SceneBuilder';
import { ThreeTimelineView } from '../../../src/infrastructure/three/ThreeTimelineView';
import type { ProjectedFrame, ProjectedNode } from '../../../src/infrastructure/three/types';
import { cleanupDom, mount } from '../../helpers/dom';
import { buildModel, fakeHandlers, makeStoryData, selection, type FakeHandlers } from '../../helpers/fixtures';
import { ManualScheduler, ManualVisibility } from '../../helpers/three';

/** jsdom no trae ResizeObserver: doble que guarda los callbacks para dispararlos a mano. */
const resizeCallbacks: (() => void)[] = [];
class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(): void {
    resizeCallbacks.push(this.callback);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  resizeCallbacks.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanupDom();
});

interface Options {
  width?: number;
  height?: number;
  reduced?: boolean;
  devicePixelRatio?: number;
  maxPixelRatio?: number;
  render?: boolean;
  bare?: boolean;
  insets?: { top: number; bottom: number };
}

interface Harness {
  view: ThreeTimelineView;
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  renderer: { domElement: HTMLCanvasElement; setPixelRatio: ReturnType<typeof vi.fn>; setSize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  post: { [K in keyof PostProcessing]: ReturnType<typeof vi.fn> };
  createPostProcessing: ReturnType<typeof vi.fn<(scene: Scene, camera: Camera) => PostProcessing>>;
  scheduler: ManualScheduler;
  handlers: FakeHandlers;
  hover: ReturnType<typeof vi.fn<NodeHoverListener['onNodeHover']>>;
  frames: ProjectedFrame[];
  built: BuiltScene[];
  model: TimelineViewModel;
  motion: { reduced: boolean };
  size: { width: number; height: number };
  /** Avanza n fotogramas de 16 ms. */
  step(frames?: number): void;
  last(): ProjectedFrame;
  node(id: string): ProjectedNode;
  scene(): Scene;
}

/** Vista real (escena, cámara, entrada) con un backend de render falso: no hace falta WebGL. */
function harness(options: Options = {}): Harness {
  const size = { width: options.width ?? 1200, height: options.height ?? 800 };
  const container = mount('div');
  container.append(document.createElement('p')); // contenido previo: el canvas debe ir delante
  Object.defineProperty(container, 'clientWidth', { get: () => size.width });
  Object.defineProperty(container, 'clientHeight', { get: () => size.height });

  const canvas = document.createElement('canvas');
  const renderer = { domElement: canvas, setPixelRatio: vi.fn(), setSize: vi.fn(), dispose: vi.fn() };
  const post = { setSize: vi.fn(), render: vi.fn(), kick: vi.fn(), dispose: vi.fn() };
  const createPostProcessing = vi.fn<(scene: Scene, camera: Camera) => PostProcessing>(() => post);
  const scheduler = new ManualScheduler();
  const motion = { reduced: options.reduced ?? true };
  const frames: ProjectedFrame[] = [];
  const built: BuiltScene[] = [];
  const realBuilder = new SceneBuilder({ particleBudget: 0.05 });
  const sceneBuilder = {
    build: (model: TimelineViewModel): BuiltScene => {
      const scene = realBuilder.build(model);
      vi.spyOn(scene, 'dispose');
      built.push(scene);
      return scene;
    },
  } as unknown as SceneBuilder;
  const hover = vi.fn<NodeHoverListener['onNodeHover']>();

  const view = new ThreeTimelineView({
    container,
    backend: { renderer, createPostProcessing },
    sceneBuilder,
    loop: new RenderLoop(scheduler, new ManualVisibility()),
    reducedMotion: () => motion.reduced,
    ...(options.bare ? {} : { hoverListener: { onNodeHover: hover }, projectionListeners: [{ onProjected: (frame) => frames.push(frame) }] }),
    ...(options.devicePixelRatio === undefined ? {} : { devicePixelRatio: () => options.devicePixelRatio as number }),
    ...(options.maxPixelRatio === undefined ? {} : { maxPixelRatio: options.maxPixelRatio }),
    ...(options.insets === undefined ? {} : { safeInsets: () => options.insets as { top: number; bottom: number } }),
  });
  const handlers = fakeHandlers();
  view.bind(handlers);
  const model = buildModel();
  if (options.render !== false) view.render(model);

  let now = 0;
  const h: Harness = {
    view, container, canvas, renderer, post, createPostProcessing, scheduler, handlers, hover, frames, built, model, motion, size,
    step(count = 1) {
      for (let i = 0; i < count; i += 1) {
        now += 16;
        scheduler.tick(now);
      }
    },
    last() {
      const frame = frames.at(-1);
      if (!frame) throw new Error('aún no se ha proyectado ningún fotograma');
      return frame;
    },
    node(id) {
      const found = h.last().nodes.find((item) => item.eventId === id);
      if (!found) throw new Error(`no hay nodo ${id}`);
      return found;
    },
    scene() {
      return createPostProcessing.mock.calls[0][0];
    },
  };
  return h;
}

function pointer(canvas: HTMLElement, type: string, x: number, y: number): void {
  canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true }));
}
function tap(canvas: HTMLElement, x: number, y: number): void {
  pointer(canvas, 'pointerdown', x, y);
  pointer(canvas, 'pointerup', x, y);
}

describe('ThreeTimelineView: montaje y tamaño', () => {
  it('inserta el canvas al principio del contenedor y crea el postprocesado sobre su escena y cámara', () => {
    const h = harness({ render: false });
    expect(h.container.firstElementChild).toBe(h.canvas);
    expect(h.canvas.classList.contains('stage__canvas')).toBe(true);
    expect(h.createPostProcessing).toHaveBeenCalledTimes(1);
    expect(h.scene().isScene).toBe(true);
    expect(h.scene().background).not.toBeNull();
  });

  it('ajusta renderer y postprocesado al tamaño del contenedor', () => {
    const h = harness({ render: false, devicePixelRatio: 1 });
    expect(h.renderer.setSize).toHaveBeenLastCalledWith(1200, 800, false);
    expect(h.renderer.setPixelRatio).toHaveBeenLastCalledWith(1);
    expect(h.post.setSize).toHaveBeenLastCalledWith(1200, 800, 1);
  });

  it('limita el pixelRatio a 2 por defecto (rendimiento) y el límite es configurable', () => {
    expect(harness({ render: false, devicePixelRatio: 3 }).renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(harness({ render: false, devicePixelRatio: 1.5 }).renderer.setPixelRatio).toHaveBeenLastCalledWith(1.5);
    expect(harness({ render: false, devicePixelRatio: 3, maxPixelRatio: 1.25 }).renderer.setPixelRatio).toHaveBeenLastCalledWith(1.25);
  });

  it('sin función inyectada usa window.devicePixelRatio (1 si no existe)', () => {
    vi.stubGlobal('devicePixelRatio', 0);
    expect(harness({ render: false }).renderer.setPixelRatio).toHaveBeenLastCalledWith(1);
    vi.stubGlobal('devicePixelRatio', 1.75);
    expect(harness({ render: false }).renderer.setPixelRatio).toHaveBeenLastCalledWith(1.75);
  });

  it('responde a los cambios de tamaño del contenedor', () => {
    const h = harness({ devicePixelRatio: 1 });
    h.size.width = 600;
    h.size.height = 900;
    resizeCallbacks.at(-1)?.();
    expect(h.renderer.setSize).toHaveBeenLastCalledWith(600, 900, false);
    expect(h.post.setSize).toHaveBeenLastCalledWith(600, 900, 1);
    h.step();
    expect(h.last().viewport).toEqual({ width: 600, height: 900 });
  });

  it('un contenedor colapsado (0×0) no produce tamaños nulos ni NaN', () => {
    const h = harness({ width: 0, height: 0, devicePixelRatio: 1 });
    expect(h.renderer.setSize).toHaveBeenLastCalledWith(1, 1, false);
    h.step();
    for (const node of h.last().nodes) expect(Number.isFinite(node.x + node.y + node.radius)).toBe(true);
  });
});

describe('ThreeTimelineView: render y bucle', () => {
  it('antes de pintar un modelo no hay bucle ni vista general', () => {
    const h = harness({ render: false });
    expect(h.scheduler.pending.size).toBe(0);
    expect(() => h.view.showOverview()).not.toThrow();
    expect(h.view.getNodeScreenPositions()).toEqual([]);
  });

  it('render monta nodos y efectos en la escena, con niebla, y arranca el bucle', () => {
    const h = harness();
    const scene = h.scene();
    for (const id of ['a-school', 'b-job', 'c-side', 'e-side-two']) expect(scene.getObjectByName(`node:${id}`)).toBeDefined();
    for (const name of ['branch:main', 'branch:side', 'nebula', 'particle-flow', 'year-markers', 'starfield:0']) {
      expect(scene.getObjectByName(name)).toBeDefined();
    }
    expect(scene.fog).not.toBeNull();
    expect(h.scheduler.pending.size).toBe(1);
  });

  it('cada fotograma actualiza, proyecta, avisa a los oyentes y renderiza con el delta', () => {
    const h = harness();
    h.step(2);
    expect(h.post.render).toHaveBeenCalledTimes(2);
    expect(h.post.render.mock.calls[1][0]).toBeCloseTo(0.016, 6);
    expect(h.frames).toHaveLength(2);
    const frame = h.last();
    expect(frame.nodes.map((node) => node.eventId)).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
    expect(frame.years.map((mark) => mark.year)).toEqual(h.model.layout.years.map((mark) => mark.year));
    expect(frame.viewport).toEqual({ width: 1200, height: 800 });
    expect(frame.nodes.map((node) => node.importance)).toEqual([2, 3, 1, 2]);
    expect(h.hover).toHaveBeenLastCalledWith(null, expect.anything());
  });

  it('funciona sin oyentes opcionales (hover / proyección)', () => {
    const h = harness({ bare: true });
    expect(() => h.step(2)).not.toThrow();
    expect(h.post.render).toHaveBeenCalledTimes(2);
    expect(h.view.getNodeScreenPositions()).toHaveLength(4);
  });

  it('la proyección respeta el orden temporal: lo posterior queda a la derecha', () => {
    const h = harness();
    h.view.showOverview();
    h.step();
    const xs = ['a-school', 'b-job', 'e-side-two'].map((id) => h.node(id).x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    // La rama lateral (carril +1) queda por encima del tronco en pantalla.
    expect(h.node('e-side-two').y).toBeLessThan(h.node('b-job').y);
    const years = h.last().years.map((mark) => mark.x);
    for (let i = 1; i < years.length; i += 1) expect(years[i]).toBeGreaterThan(years[i - 1]);
  });

  it('la apertura encuadra el presente: "hoy" queda a la vista, en la mitad derecha', () => {
    const h = harness();
    h.step();
    const { nowX } = h.last();
    expect(nowX).not.toBeNull();
    expect(nowX as number).toBeGreaterThan(600);
    expect(nowX as number).toBeLessThan(1200);
  });

  it('sin movimiento reducido la apertura es un vuelo desde la vista general', () => {
    const h = harness({ reduced: false });
    h.step(2);
    const start = h.last().cameraDistance;
    expect(start).toBeGreaterThan(50);
    h.step(600);
    expect(h.last().cameraDistance).toBeCloseTo(44, 1);
    expect(h.last().cameraDistance).toBeLessThan(start);
  });

  it('en pantallas estrechas la cámara se aleja para que quepan varios años', () => {
    const wide = harness();
    wide.step();
    const narrow = harness({ width: 400, height: 800 });
    narrow.step();
    expect(wide.last().cameraDistance).toBeCloseTo(44, 5);
    expect(narrow.last().cameraDistance).toBeCloseTo(44 * 1.7, 5);
  });

  it('volver a pintar libera la escena anterior y no duplica objetos', () => {
    const h = harness();
    const before = h.scene().children.length;
    h.view.render(h.model);
    expect(h.built).toHaveLength(2);
    expect(h.built[0].dispose).toHaveBeenCalledTimes(1);
    expect(h.built[1].dispose).not.toHaveBeenCalled();
    expect(h.scene().children).toHaveLength(before);
    h.step();
    expect(h.last().nodes).toHaveLength(4);
  });
});

describe('ThreeTimelineView: filtro y selección', () => {
  it('los nodos filtrados se atenúan (no desaparecen) y dejan de ser "visibles"', () => {
    const h = harness();
    h.view.applyFilter({ activeCategoryIds: new Set(['work']), visibleEventIds: new Set(['b-job', 'e-side-two']), totalEvents: 4 });
    h.view.showOverview();
    h.step();
    expect(h.last().nodes.map((node) => node.presence)).toEqual([0.1, 1, 0.1, 1]);
    const positions = Object.fromEntries(h.view.getNodeScreenPositions().map((node) => [node.id, node.visible]));
    expect(positions).toEqual({ 'a-school': false, 'b-job': true, 'c-side': false, 'e-side-two': true });
  });

  it('sin movimiento reducido el atenuado es una transición', () => {
    const h = harness({ reduced: false });
    h.view.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 4 });
    h.step(3);
    const early = h.node('a-school').presence;
    expect(early).toBeLessThan(1);
    expect(early).toBeGreaterThan(0.5);
    h.step(400);
    expect(h.node('a-school').presence).toBeCloseTo(0.1, 3);
  });

  it('enfocar un evento vuela la cámara hasta centrarlo, lo resalta y lanza el pulso', () => {
    const h = harness();
    h.view.applySelection(selection('a-school'));
    h.step();
    const node = h.node('a-school');
    expect(Math.abs(node.x - 600)).toBeLessThan(12);
    expect(Math.abs(node.y - 400)).toBeLessThan(12);
    expect(node.highlighted).toBe(true);
    expect(h.node('b-job').highlighted).toBe(false);
    expect(h.last().cameraDistance).toBeCloseTo(44, 5);
    expect(h.built[0].pulse.rings.every((ring) => ring.sprite.position.x === h.model.layout.nodes[0].position.x)).toBe(true);
  });

  it('cambiar el foco quita el resalte al nodo anterior', () => {
    const h = harness();
    h.view.applySelection(selection('a-school'));
    h.view.applySelection(selection('b-job'));
    h.step();
    expect(h.node('a-school').highlighted).toBe(false);
    expect(h.node('b-job').highlighted).toBe(true);
    h.view.applySelection(selection(null));
    h.step();
    expect(h.last().nodes.some((node) => node.highlighted)).toBe(false);
  });

  it('abrir el detalle acerca la cámara y desplaza el encuadre para dejar sitio al panel lateral', () => {
    const h = harness();
    h.view.applySelection(selection('b-job', true));
    h.step();
    expect(h.last().cameraDistance).toBeCloseTo(21, 5);
    const node = h.node('b-job');
    expect(node.x).toBeLessThan(450);
    expect(node.x).toBeGreaterThan(300);
    expect(Math.abs(node.y - 400)).toBeLessThan(12);
  });

  it('en pantallas estrechas (pop-up a pantalla completa) el nodo se queda centrado', () => {
    const h = harness({ width: 600, height: 900 });
    h.view.applySelection(selection('b-job', true));
    h.step();
    expect(Math.abs(h.node('b-job').x - 300)).toBeLessThan(12);
  });

  it('al cerrar el detalle la cámara recupera la distancia que tenía y vuelve a centrar', () => {
    const h = harness();
    h.view.zoomBy(1.5); // 66
    h.view.applySelection(selection('b-job', true));
    h.step();
    expect(h.last().cameraDistance).toBeCloseTo(21, 5);
    h.view.applySelection(selection('b-job', false));
    h.step();
    expect(h.last().cameraDistance).toBeCloseTo(66, 5);
    expect(Math.abs(h.node('b-job').x - 600)).toBeLessThan(12);
  });

  it('si se abrió desde muy cerca, al cerrar se aleja al menos hasta una distancia cómoda', () => {
    const h = harness();
    h.view.zoomBy(0.25); // 11
    h.view.applySelection(selection('b-job', true));
    h.view.applySelection(selection('b-job', false));
    h.step();
    expect(h.last().cameraDistance).toBeCloseTo(31.5, 5);
  });

  it('el bloom da un golpe al seleccionar (más fuerte al abrir); con movimiento reducido, no', () => {
    const h = harness({ reduced: false });
    h.view.applySelection(selection('a-school'));
    expect(h.post.kick).toHaveBeenLastCalledWith(0.45);
    h.view.applySelection(selection('a-school', true));
    expect(h.post.kick).toHaveBeenLastCalledWith(0.9);
    expect(h.built[0].pulse.isActive).toBe(true);

    const calm = harness({ reduced: true });
    calm.view.applySelection(selection('a-school', true));
    expect(calm.post.kick).not.toHaveBeenCalled();
  });

  it('reaplicar la misma selección no repite el vuelo ni el pulso', () => {
    const h = harness({ reduced: false });
    h.view.applySelection(selection('a-school', true));
    h.view.applySelection(selection('a-school', true, { hasNext: false }));
    expect(h.post.kick).toHaveBeenCalledTimes(1);
  });

  it('seleccionar un evento que no está en la escena no falla', () => {
    const h = harness();
    expect(() => h.view.applySelection(selection('fantasma', true))).not.toThrow();
    expect(h.post.kick).not.toHaveBeenCalled();
  });
});

describe('ThreeTimelineView: entrada', () => {
  it('clic sobre un nodo → abrir su detalle', () => {
    const h = harness();
    h.view.showOverview();
    h.step();
    const node = h.node('b-job');
    tap(h.canvas, node.x, node.y);
    expect(h.handlers.onEventActivated).toHaveBeenCalledExactlyOnceWith('b-job');
  });

  it('clic en el vacío → soltar la selección o, con el detalle abierto, cerrarlo', () => {
    const h = harness();
    h.view.showOverview();
    h.step();
    tap(h.canvas, 5, 5);
    expect(h.handlers.onSelectionCleared).toHaveBeenCalledTimes(1);
    expect(h.handlers.onDetailClosed).not.toHaveBeenCalled();

    h.view.applySelection(selection('b-job', true));
    h.step();
    tap(h.canvas, 5, 5);
    expect(h.handlers.onDetailClosed).toHaveBeenCalledTimes(1);
    expect(h.handlers.onEventActivated).not.toHaveBeenCalled();
  });

  it('un nodo filtrado no se puede pulsar', () => {
    const h = harness();
    h.view.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(['a-school']), totalEvents: 4 });
    h.view.showOverview();
    h.step();
    const node = h.node('b-job');
    tap(h.canvas, node.x, node.y);
    expect(h.handlers.onEventActivated).not.toHaveBeenCalled();
    expect(h.handlers.onSelectionCleared).toHaveBeenCalledTimes(1);
  });

  it('un clic antes del primer fotograma no falla', () => {
    const h = harness();
    expect(() => tap(h.canvas, 10, 10)).not.toThrow();
    expect(h.handlers.onSelectionCleared).toHaveBeenCalledTimes(1);
  });

  it('pasar el ratón sobre un nodo lo resalta, cambia el cursor y avisa al tooltip encima del nodo', () => {
    const h = harness();
    h.canvas.getBoundingClientRect = (): DOMRect => new DOMRect(40, 20, 1200, 800);
    h.view.showOverview();
    h.step();
    const node = h.node('b-job');
    pointer(h.canvas, 'pointermove', 40 + node.x, 20 + node.y);
    h.step(2); // el resalte se ve en la proyección del fotograma siguiente

    expect(h.canvas.classList.contains('stage__canvas--pointing')).toBe(true);
    expect(h.node('b-job').highlighted).toBe(true);
    const [id, at] = h.hover.mock.calls.at(-1) as [string | null, { x: number; y: number }];
    expect(id).toBe('b-job');
    expect(at.x).toBeCloseTo(40 + h.node('b-job').x, 3);
    expect(at.y).toBeLessThan(20 + h.node('b-job').y - 14);

    pointer(h.canvas, 'pointermove', 45, 25);
    h.step(2);
    expect(h.canvas.classList.contains('stage__canvas--pointing')).toBe(false);
    expect(h.node('b-job').highlighted).toBe(false);
    expect(h.hover.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('al salir el puntero de la escena se retira el hover', () => {
    const h = harness();
    h.view.showOverview();
    h.step();
    const node = h.node('b-job');
    pointer(h.canvas, 'pointermove', node.x, node.y);
    h.step();
    pointer(h.canvas, 'pointerleave', 0, 0);
    h.step();
    expect(h.hover.mock.calls.at(-1)?.[0]).toBeNull();
    expect(h.canvas.classList.contains('stage__canvas--pointing')).toBe(false);
  });

  it('arrastrar desplaza la escena con el puntero', () => {
    const h = harness();
    h.view.showOverview();
    h.step();
    const before = h.node('b-job');
    pointer(h.canvas, 'pointerdown', 600, 400);
    pointer(h.canvas, 'pointermove', 500, 400);
    pointer(h.canvas, 'pointerup', 500, 400);
    h.step();
    expect(h.node('b-job').x).toBeLessThan(before.x - 50);
    expect(h.handlers.onSelectionCleared).not.toHaveBeenCalled();
  });

  it('la rueda viaja por el tiempo: hacia abajo avanza al futuro (la escena se va a la izquierda)', () => {
    const h = harness();
    h.view.showOverview();
    h.view.zoomBy(0.3);
    h.step();
    const before = h.node('a-school').x;
    const distance = h.last().cameraDistance;
    h.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    h.step();
    expect(h.node('a-school').x).toBeLessThan(before - 20);
    expect(h.last().cameraDistance).toBe(distance);
  });

  it('Ctrl+rueda hace zoom', () => {
    const h = harness();
    h.step();
    const before = h.last().cameraDistance;
    h.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, ctrlKey: true, bubbles: true, cancelable: true }));
    h.step();
    expect(h.last().cameraDistance).toBeLessThan(before);
  });
});

describe('ThreeTimelineView: controles de cámara', () => {
  it('zoomBy acerca y aleja; los nodos se ven más grandes de cerca', () => {
    const h = harness();
    h.view.applySelection(selection('b-job'));
    h.step();
    const radius = h.node('b-job').radius;
    h.view.zoomBy(0.5);
    h.step();
    expect(h.last().cameraDistance).toBeCloseTo(22, 5);
    expect(h.node('b-job').radius).toBeGreaterThan(radius * 1.8);
    h.view.zoomBy(4);
    h.step();
    expect(h.last().cameraDistance).toBeCloseTo(88, 5);
  });

  it('showOverview encuadra toda la línea temporal', () => {
    const h = harness();
    h.view.showOverview();
    h.step();
    const visible = h.view.getNodeScreenPositions();
    expect(visible.map((node) => node.visible)).toEqual([true, true, true, true]);
    expect(h.last().cameraDistance).toBeGreaterThan(44);
    expect(h.last().cameraDistance).toBeLessThanOrEqual(160);
  });

  it('getNodeScreenPositions devuelve píxeles de ventana y marca lo que queda fuera de pantalla', () => {
    const h = harness();
    h.canvas.getBoundingClientRect = (): DOMRect => new DOMRect(40, 20, 1200, 800);
    h.view.applySelection(selection('e-side-two', true));
    h.step();
    const positions = Object.fromEntries(h.view.getNodeScreenPositions().map((node) => [node.id, node]));
    expect(positions['e-side-two'].visible).toBe(true);
    expect(positions['e-side-two'].x).toBe(Math.round(40 + h.node('e-side-two').x));
    expect(positions['e-side-two'].y).toBe(Math.round(20 + h.node('e-side-two').y));
    // A distancia de detalle, el primer evento (8 años antes) no cabe en pantalla.
    expect(positions['a-school'].visible).toBe(false);
  });
});

describe('ThreeTimelineView: encuadre con franjas reservadas', () => {
  const meanY = (h: Harness): number => {
    const nodes = h.last().nodes;
    return nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
  };

  it('la vista general centra las ramas en la franja libre, no en la ventana', () => {
    const free = harness();
    free.view.showOverview();
    free.step();
    const reserved = harness({ insets: { top: 0, bottom: 400 } });
    reserved.view.showOverview();
    reserved.step();
    // Con la mitad inferior tapada, las ramas suben hacia la franja libre de arriba.
    expect(meanY(reserved)).toBeLessThan(meanY(free) - 100);
    expect(meanY(reserved)).toBeLessThan(400);
  });

  it('con franjas que tapan casi todo, se reserva una franja mínima y la cámara se aleja', () => {
    const free = harness();
    free.view.showOverview();
    free.step();
    const tight = harness({ insets: { top: 390, bottom: 390 } });
    tight.view.showOverview();
    tight.step();
    expect(Number.isFinite(meanY(tight))).toBe(true);
    expect(tight.last().cameraDistance).toBeGreaterThanOrEqual(free.last().cameraDistance);
  });
});

describe('ThreeTimelineView: líneas vitales', () => {
  it('highlightBranch resalta la línea en la escena y se conserva al volver a pintar', () => {
    const h = harness();
    h.view.highlightBranch('side');
    h.step();
    const curves = (index: number): Record<string, number> =>
      Object.fromEntries(h.built[index].branches.map((curve) => [curve.id, curve.currentEmphasis]));
    expect(curves(0).side).toBeGreaterThan(1);
    expect(curves(0).main).toBeLessThan(1);
    h.view.render(h.model);
    h.step();
    expect(curves(1).side).toBeGreaterThan(1);
    h.view.highlightBranch(null);
    h.step();
    expect(curves(1)).toEqual({ main: 1, side: 1 });
  });

  it('highlightBranch antes de pintar no falla', () => {
    expect(() => harness({ render: false }).view.highlightBranch('side')).not.toThrow();
  });

  it('la niebla se aclara al alejarse (la vista general de una vida larga no se apaga)', () => {
    const h = harness();
    h.step();
    const fog = h.scene().fog as FogExp2;
    const near = fog.density;
    h.view.zoomBy(4);
    h.step(2);
    expect(fog.density).toBeLessThan(near);
    expect(fog.density).toBeGreaterThan(0);
  });
});

describe('ThreeTimelineView: arcos y modo historia', () => {
  const storyModel = buildModel(makeStoryData());
  const story = (eventId: string, fromEventId: string | null) => ({
    index: 0,
    total: 4,
    eventId,
    fromEventId,
    arcId: null,
    newChapter: false,
  });

  it('proyecta los arcos en pantalla y marca activo el capítulo en el que está la cámara', () => {
    const h = harness();
    h.view.render(storyModel);
    h.view.applySelection(selection('a-school'));
    h.step();
    const arcs = h.last().arcs ?? [];
    expect(arcs.map((arc) => arc.id)).toEqual(['aprender', 'oficio', 'desvio']);
    expect(arcs.every((arc) => arc.endX > arc.startX)).toBe(true);
    expect(arcs.filter((arc) => arc.active).map((arc) => arc.id)).toEqual(['aprender']);
    expect(h.built.at(-1)?.arcs.active).toBe('aprender');
  });

  it('en la historia, el paso siguiente es un vuelo a lo largo del tiempo (no un corte)', () => {
    const h = harness({ reduced: false });
    h.view.render(storyModel);
    h.view.applySelection({ ...selection('a-school', true), story: story('a-school', null) });
    h.step(400);
    h.view.applySelection({ ...selection('b-job', true), story: story('b-job', 'a-school') });
    h.step(20);
    const mid = h.node('b-job').x;
    h.step(400);
    const end = h.node('b-job').x;
    expect(mid).toBeGreaterThan(end + 50); // a mitad de vuelo el destino aún queda a la derecha
    // Con el panel lateral el nodo queda desplazado a la izquierda del centro.
    expect(end).toBeLessThan(600);
    expect(h.node('b-job').highlighted).toBe(true);
  });

  it('con movimiento reducido el paso de la historia es un corte', () => {
    const h = harness({ reduced: true, width: 700 });
    h.view.render(storyModel);
    h.view.applySelection({ ...selection('a-school', true), story: story('a-school', null) });
    h.step();
    h.view.applySelection({ ...selection('b-job', true), story: story('b-job', 'a-school') });
    h.step();
    expect(Math.abs(h.node('b-job').x - 350)).toBeLessThan(12);
  });
});
