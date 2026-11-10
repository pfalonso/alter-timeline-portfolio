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
import { EventList } from './infrastructure/dom/EventList';
import { EventPopup } from './infrastructure/dom/EventPopup';
import { FilterBar } from './infrastructure/dom/FilterBar';
import { Hud } from './infrastructure/dom/Hud';
import { KeyboardShortcuts } from './infrastructure/dom/KeyboardShortcuts';
import { LiveAnnouncer } from './infrastructure/dom/LiveAnnouncer';
import { NodeLabels } from './infrastructure/dom/NodeLabels';
import { STRINGS } from './infrastructure/dom/strings';
import { Tooltip } from './infrastructure/dom/Tooltip';
import { ViewControls } from './infrastructure/dom/ViewControls';
import { YearRuler } from './infrastructure/dom/YearRuler';
import { DEFAULT_URLS, HttpJsonTimelineRepository } from './infrastructure/http/HttpJsonTimelineRepository';
import { readUrlFlag, UrlFilterStateStore } from './infrastructure/storage/UrlFilterStateStore';
import { RenderLoop } from './infrastructure/three/RenderLoop';
import { SceneBuilder } from './infrastructure/three/SceneBuilder';
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
  const labels = new NodeLabels(byId('labels'), [byId('hud'), byId('filters')]);
  const ruler = new YearRuler(byId('ruler'));
  const eventList = new EventList(byId('index'), byId<HTMLButtonElement>('index-toggle'));

  const parts: TimelineViewPart[] = [
    new Hud(byId('hud')),
    new FilterBar(byId('filters')),
    new EventPopup(byId('popup')),
    new LiveAnnouncer(byId('announcer')),
    new KeyboardShortcuts(window),
    eventList,
    tooltip,
    labels,
    ruler,
  ];

  const backend = readUrlFlag(href, 'nowebgl') ? null : createWebGLBackend();
  let three: ThreeTimelineView | null = null;
  if (backend) {
    const stage = byId('stage');
    stage.setAttribute('role', 'application');
    stage.setAttribute('aria-label', STRINGS.stageLabel);
    stage.tabIndex = 0;
    three = new ThreeTimelineView({
      container: stage,
      backend,
      sceneBuilder: new SceneBuilder({ particleBudget: reducedMotion() ? 0.3 : compact ? 0.6 : 1 }),
      loop: new RenderLoop(),
      reducedMotion,
      hoverListener: tooltip,
      projectionListeners: [labels, ruler],
    });
    parts.push(three);
    new ViewControls(byId('controls'), three);
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
    };
  }
}

void bootstrap();
