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
import { AppModes, InteractionHint } from './infrastructure/dom/AppModes';
import { EventList } from './infrastructure/dom/EventList';
import { EventPopup } from './infrastructure/dom/EventPopup';
import { FilterBar } from './infrastructure/dom/FilterBar';
import { FilterSummary } from './infrastructure/dom/FilterSummary';
import { icon } from './infrastructure/dom/icons';
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
  const touch = window.matchMedia('(pointer: coarse)').matches;
  app.classList.toggle('app--touch', touch);
  // Una sola pista de acción, que desaparece tras la primera interacción (los atajos, tras «?»).
  new InteractionHint(byId('help'), touch ? STRINGS.hintTouch : STRINGS.hintKeys, byId('stage'));
  const filtersSheet = bindSheet(app, byId('filters'), byId<HTMLButtonElement>('filters-open'), byId<HTMLButtonElement>('filters-close'));

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
  const labels = new NodeLabels(
    byId('labels'),
    [
      byId('hud-main'),
      byId('hud-cta'),
      byId('hud-contact'),
      byId('filters'),
      byId('controls'),
      byId('shortcuts'),
      byId('ruler'),
      byId('arc-strip'),
      byId('chapter'),
      byId('story-end'),
      byId('popup'),
      byId('index'),
      byId('help'),
    ],
    // La apertura dibuja la línea sin rótulos; entran cuando la cámara se detiene.
    { openingHoldMs: reducedMotion() ? 0 : 2200 },
  );
  const ruler = new YearRuler(byId('ruler'));
  const arcStrip = new ArcStrip(byId('arc-strip'));
  const eventList = new EventList(byId('index'), byId<HTMLButtonElement>('index-toggle'));

  const parts: TimelineViewPart[] = [
    new AppModes(app),
    new Hud(byId('hud-main'), byId('hud-contact')),
    new FilterBar(byId('filter-bar'), { toggle: byId<HTMLButtonElement>('more-toggle'), panel: byId('more-filters') }),
    new FilterSummary(byId('filter-result')),
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
      fullButton: byId<HTMLButtonElement>('story-full'),
      endCard: byId('story-end'),
    }),
  ];
  // Abrir una ficha o entrar en la historia cierra la hoja de filtros (móvil).
  parts.push({ applySelection: (state) => (state.detailOpen || state.story ? filtersSheet.close() : undefined) });

  const backend = readUrlFlag(href, 'nowebgl') ? null : createWebGLBackend();
  let three: ThreeTimelineView | null = null;
  if (backend) {
    const stage = byId('stage');
    stage.setAttribute('role', 'application');
    stage.setAttribute('aria-label', STRINGS.stageLabel);
    stage.tabIndex = 0;
    const ghostLabels = new GhostLabels(byId('ghost-labels'), () => labels.occupied());
    const legend = new LineLegend(
      byId('lines'),
      { highlightBranch: (id) => three?.highlightBranch(id) },
      { fallbackColor: DEFAULT_PALETTE.trunk, keysRoot: byId('scene-keys') },
    );
    three = new ThreeTimelineView({
      container: stage,
      backend,
      sceneBuilder: new SceneBuilder({ particleBudget: reducedMotion() ? 0.3 : compact ? 0.6 : 1 }),
      loop: new RenderLoop(),
      reducedMotion,
      hoverListener: tooltip,
      projectionListeners: [labels, ghostLabels, ruler, arcStrip, legend],
      // La cabecera, la fila de controles, la barra de líneas y (en móvil) el botón principal fijo
      // reservan su franja: la trenza nunca pasa por debajo de un enlace (U-08, U-59).
      safeInsets: () =>
        measureSafeInsets(stage, [byId('hud-main'), byId('hud-cta'), byId('hud-contact'), byId('controls'), byId('filters'), byId('ruler')]),
      detailInsets: () => measureSafeInsets(stage, [byId('popup')]),
    });
    parts.push(three);
    new ViewControls(byId('controls'), three, window, byId('shortcuts'));
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
 * Franjas de la escena tapadas por la interfaz. Cada bloque visible cuenta arriba si está en la mitad
 * superior y abajo si está en la inferior (en móvil, el botón principal va fijo abajo). Se miden al
 * encuadrar, no cada fotograma.
 */
function measureSafeInsets(stage: HTMLElement, blocks: readonly HTMLElement[]): { top: number; bottom: number } {
  const area = stage.getBoundingClientRect();
  const gap = 16;
  let top = 0;
  let bottom = 0;
  for (const block of blocks) {
    if (block.hidden || block.getClientRects().length === 0) continue;
    const rect = block.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) continue;
    const middle = (rect.top + rect.bottom) / 2 - area.top;
    if (middle < area.height / 2) top = Math.max(top, rect.bottom - area.top + gap);
    else bottom = Math.max(bottom, area.bottom - rect.top + gap);
  }
  return { top: Math.max(0, top), bottom: Math.max(0, bottom) };
}

/**
 * Hoja de «Líneas y filtros» en móvil: se abre con un botón, se superpone (no empuja la escena) y se
 * cierra con su botón, con Esc o al abrir una ficha. En escritorio no tiene efecto visual.
 */
function bindSheet(
  app: HTMLElement,
  sheet: HTMLElement,
  open: HTMLButtonElement,
  close: HTMLButtonElement,
): { close(): void } {
  close.append(icon('close'));
  const set = (value: boolean): void => {
    sheet.classList.toggle('filters--open', value);
    app.classList.toggle('app--sheet', value);
    open.setAttribute('aria-expanded', String(value));
    if (value) close.focus({ preventScroll: true });
  };
  open.addEventListener('click', () => set(!sheet.classList.contains('filters--open')));
  close.addEventListener('click', () => {
    set(false);
    open.focus({ preventScroll: true });
  });
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sheet.classList.contains('filters--open')) {
      event.stopPropagation();
      set(false);
      open.focus({ preventScroll: true });
    }
  });
  return { close: () => (sheet.classList.contains('filters--open') ? set(false) : undefined) };
}
