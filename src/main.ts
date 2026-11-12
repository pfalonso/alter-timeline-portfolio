import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource-variable/hanken-grotesk/index.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles/main.css';

import { TimelineController } from './application/TimelineController';
import { LoadTimeline, NavigateEvents, SelectEvent, ToggleCategoryFilter } from './application/usecases';
import { EventFilter, LifeDataValidator, TimelineFactory, TimelineLayout } from './domain/services';
import { CompositeTimelineView, type TimelineViewPart } from './infrastructure/dom/CompositeTimelineView';
import { ArcStrip } from './infrastructure/dom/ArcStrip';
import { EventList } from './infrastructure/dom/EventList';
import { EventPopup } from './infrastructure/dom/EventPopup';
import { FilterBar } from './infrastructure/dom/FilterBar';
import { Hud } from './infrastructure/dom/Hud';
import { KeyboardShortcuts } from './infrastructure/dom/KeyboardShortcuts';
import { LineLegend } from './infrastructure/dom/LineLegend';
import { LiveAnnouncer } from './infrastructure/dom/LiveAnnouncer';
import { NodeLabels } from './infrastructure/dom/NodeLabels';
import { GhostLabels } from './infrastructure/dom/GhostLabels';
import { StoryControls } from './infrastructure/dom/StoryControls';
import { STRINGS } from './infrastructure/dom/strings';
import { Tooltip } from './infrastructure/dom/Tooltip';
import { ViewControls } from './infrastructure/dom/ViewControls';
import { YearRuler } from './infrastructure/dom/YearRuler';
import { DEFAULT_URLS, HttpJsonTimelineRepository } from './infrastructure/http/HttpJsonTimelineRepository';
import { readUrlFlag, UrlFilterStateStore } from './infrastructure/storage/UrlFilterStateStore';
import { RenderLoop } from './infrastructure/three/RenderLoop';
import { DEFAULT_PALETTE, SceneBuilder } from './infrastructure/three/SceneBuilder';
import { ThreeTimelineView } from './infrastructure/three/ThreeTimelineView';
import { createWebGLBackend } from './infrastructure/three/webgl';

declare global {
  interface Window {
    /** Solo con `?debug=1`: ganchos para automatización (scripts/ui-check.mjs). */
    __timelineDebug?: {
      ready: boolean;
      webgl: boolean;
      nodes(): { id: string; x: number; y: number; visible: boolean }[];
      open(eventId: string): void;
      /** Estado del modo historia: activo y texto del progreso ("3 / 22"). */
      story(): { active: boolean; step: string | null };
    };
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta #${id} en index.html`);
  return node as T;
}

/** Composition root: la única pieza que conoce todas las capas. */
async function bootstrap(): Promise<void> {
  const app = byId('app');
  const loading = byId('loading');
  loading.textContent = STRINGS.loading;
  // En pantallas táctiles no hay teclado ni rueda: se explican los gestos.
  byId('help').textContent = window.matchMedia('(pointer: coarse)').matches ? STRINGS.helpTouch : STRINGS.helpKeys;

  const href = window.location.href;
  const debug = readUrlFlag(href, 'debug');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = (): boolean => motionQuery.matches || readUrlFlag(href, 'reduced-motion');
  const compact = window.matchMedia('(max-width: 720px)').matches;

  // Infraestructura
  // `?example=1` fuerza los datos de ejemplo aunque exista un life.json personal.
  const repository = new HttpJsonTimelineRepository(
    (input, init) => fetch(input, init),
    new LifeDataValidator(),
    readUrlFlag(href, 'example') ? { ...DEFAULT_URLS, primary: null } : DEFAULT_URLS,
  );
  const filterStore = new UrlFilterStateStore(window.location, window.history);
  const tooltip = new Tooltip(byId('tooltip'));
  const labels = new NodeLabels(byId('labels'), [
    byId('hud'),
    byId('filters'),
    byId('controls'),
    byId('ruler'),
    byId('arc-strip'),
    byId('chapter'),
    byId('story-toggle'),
    byId('popup'),
    byId('index'),
  ]);
  const ruler = new YearRuler(byId('ruler'));
  const arcStrip = new ArcStrip(byId('arc-strip'));
  const eventList = new EventList(byId('index'), byId<HTMLButtonElement>('index-toggle'));

  const parts: TimelineViewPart[] = [
    new Hud(byId('hud')),
    new FilterBar(byId('filter-bar')),
    new EventPopup(byId('popup')),
    new LiveAnnouncer(byId('announcer')),
    new KeyboardShortcuts(window),
    eventList,
    tooltip,
    labels,
    ruler,
    arcStrip,
    new StoryControls(byId<HTMLButtonElement>('story-toggle'), byId('chapter'), {
      app,
      focusAfterCard: () => document.getElementById('popup'),
    }),
  ];

  const backend = readUrlFlag(href, 'nowebgl') ? null : createWebGLBackend();
  let three: ThreeTimelineView | null = null;
  if (backend) {
    const stage = byId('stage');
    stage.setAttribute('role', 'application');
    stage.setAttribute('aria-label', STRINGS.stageLabel);
    stage.tabIndex = 0;
    const ghostLabels = new GhostLabels(byId('ghost-labels'));
    const legend = new LineLegend(byId('lines'), { highlightBranch: (id) => three?.highlightBranch(id) }, { fallbackColor: DEFAULT_PALETTE.trunk });
    three = new ThreeTimelineView({
      container: stage,
      backend,
      sceneBuilder: new SceneBuilder({ particleBudget: reducedMotion() ? 0.3 : compact ? 0.6 : 1 }),
      loop: new RenderLoop(),
      reducedMotion,
      hoverListener: tooltip,
      projectionListeners: [labels, ghostLabels, ruler, arcStrip, legend],
      safeInsets: () =>
        measureSafeInsets(
          stage,
          { always: byId('controls'), ifWide: byId('hud') },
          { always: byId('filters'), ifWide: byId('help') },
        ),
    });
    parts.push(three);
    new ViewControls(byId('controls'), three);
    parts.push(legend, ghostLabels);
  } else {
    app.classList.add('app--no-webgl');
    eventList.showAsMainContent(STRINGS.noWebgl);
  }

  // Aplicación
  const controller = new TimelineController({
    view: new CompositeTimelineView(parts),
    filterStore,
    eventFilter: new EventFilter(),
    loadTimeline: new LoadTimeline(repository, new TimelineFactory(), new TimelineLayout(), {
      includePrivate: readUrlFlag(href, 'private'),
      clock: () => new Date(),
    }),
    toggleCategoryFilter: new ToggleCategoryFilter(filterStore),
    selectEvent: new SelectEvent(),
    navigateEvents: new NavigateEvents(),
  });

  const ok = await controller.start();
  loading.hidden = true;
  app.classList.remove('app--loading');
  app.classList.toggle('app--error', !ok);

  if (debug) {
    window.__timelineDebug = {
      ready: ok,
      webgl: three !== null,
      nodes: () => three?.getNodeScreenPositions() ?? [],
      open: (eventId) => controller.onEventActivated(eventId),
      story: () => ({
        active: app.classList.contains('app--story'),
        step: document.querySelector('#popup .popup__step')?.textContent ?? null,
      }),
    };
  }
}

void bootstrap();

/**
 * Franjas de la escena tapadas por la interfaz. Arriba cuenta siempre la fila de controles; abajo,
 * el borde superior de los filtros. Los bloques que ocupan casi todo el ancho (en móvil, la cabecera
 * y la ayuda) también reservan su franja: la escena no tiene un hueco lateral por el que asomar.
 * Se miden al encuadrar, no cada fotograma.
 */
function measureSafeInsets(
  stage: HTMLElement,
  top: { always: HTMLElement; ifWide: HTMLElement },
  bottom: { always: HTMLElement; ifWide: HTMLElement },
): { top: number; bottom: number } {
  const area = stage.getBoundingClientRect();
  const gap = 12;
  const rects = (pair: { always: HTMLElement; ifWide: HTMLElement }): DOMRect[] =>
    [pair.always, pair.ifWide]
      .map((element) => element.getBoundingClientRect())
      .filter((rect, i) => rect.height > 0 && (i === 0 || rect.width >= area.width * 0.6));
  const topRects = rects(top);
  const bottomRects = rects(bottom);
  return {
    top: topRects.length ? Math.max(0, Math.max(...topRects.map((rect) => rect.bottom)) - area.top + gap) : 0,
    bottom: bottomRects.length ? Math.max(0, area.bottom - Math.min(...bottomRects.map((rect) => rect.top)) + gap) : 0,
  };
}
