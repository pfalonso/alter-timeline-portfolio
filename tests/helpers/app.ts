import { TimelineController } from '../../src/application/TimelineController';
import { LoadTimeline, NavigateEvents, SelectEvent, ToggleCategoryFilter } from '../../src/application/usecases';
import { EventFilter, LifeDataValidator, TimelineFactory, TimelineLayout } from '../../src/domain/services';
import { CompositeTimelineView } from '../../src/infrastructure/dom/CompositeTimelineView';
import { EventList } from '../../src/infrastructure/dom/EventList';
import { EventPopup } from '../../src/infrastructure/dom/EventPopup';
import { FilterBar } from '../../src/infrastructure/dom/FilterBar';
import { Hud } from '../../src/infrastructure/dom/Hud';
import { KeyboardShortcuts } from '../../src/infrastructure/dom/KeyboardShortcuts';
import { LiveAnnouncer } from '../../src/infrastructure/dom/LiveAnnouncer';
import { NodeLabels } from '../../src/infrastructure/dom/NodeLabels';
import { Tooltip } from '../../src/infrastructure/dom/Tooltip';
import { HttpJsonTimelineRepository, type FetchLike } from '../../src/infrastructure/http/HttpJsonTimelineRepository';
import { readUrlFlag, UrlFilterStateStore } from '../../src/infrastructure/storage/UrlFilterStateStore';
import { NOW } from './fixtures';

export interface TestApp {
  readonly app: HTMLElement;
  readonly hud: HTMLElement;
  readonly filters: HTMLElement;
  readonly popup: HTMLElement;
  readonly announcer: HTMLElement;
  readonly index: HTMLElement;
  readonly indexToggle: HTMLButtonElement;
  readonly stage: HTMLElement;
  readonly tooltip: Tooltip;
  readonly tooltipRoot: HTMLElement;
  readonly labels: HTMLElement;
  readonly controller: TimelineController;
  readonly started: boolean;
  readonly warnings: string[];
}

/** Responde a `fetch` con el JSON indicado por URL; lo que no esté en el mapa es un 404. */
export function jsonFetch(routes: Record<string, unknown>): FetchLike {
  return (url) =>
    Promise.resolve(
      url in routes
        ? ({ ok: true, status: 200, json: () => Promise.resolve(routes[url]) } as Response)
        : ({ ok: false, status: 404, json: () => Promise.reject(new Error('sin cuerpo')) } as Response),
    );
}

/**
 * Monta la aplicación como `main.ts` pero sin la escena 3D (modo lista): mismo cableado de
 * repositorio, almacén de filtro en la URL, controlador y componentes DOM.
 */
export async function mountApp(fetchFn: FetchLike): Promise<TestApp> {
  const app = document.createElement('div');
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, keepPopup = false): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    node.id = id;
    if (keepPopup) node.setAttribute('data-keep-popup', '');
    app.append(node);
    return node;
  };
  const hud = make('header', 'hud');
  const filters = make('nav', 'filters', true);
  const stage = make('div', 'stage', true);
  const indexToggle = make('button', 'index-toggle', true);
  const index = make('nav', 'index', true);
  index.hidden = true;
  const popup = make('aside', 'popup');
  const announcer = make('div', 'announcer');
  const tooltipRoot = make('div', 'tooltip');
  const labels = make('div', 'labels');
  document.body.append(app);

  const warnings: string[] = [];
  const href = window.location.href;
  const filterStore = new UrlFilterStateStore(window.location, window.history);
  const tooltip = new Tooltip(tooltipRoot);
  const view = new CompositeTimelineView([
    new Hud(hud),
    new FilterBar(filters),
    new EventPopup(popup),
    new LiveAnnouncer(announcer),
    new KeyboardShortcuts(app),
    new EventList(index, indexToggle),
    tooltip,
    new NodeLabels(labels),
  ]);
  const controller = new TimelineController({
    view,
    filterStore,
    eventFilter: new EventFilter(),
    loadTimeline: new LoadTimeline(
      new HttpJsonTimelineRepository(fetchFn, new LifeDataValidator(), undefined, (message) => warnings.push(message)),
      new TimelineFactory(),
      new TimelineLayout(),
      { includePrivate: readUrlFlag(href, 'private'), clock: () => NOW },
    ),
    toggleCategoryFilter: new ToggleCategoryFilter(filterStore),
    selectEvent: new SelectEvent(),
    navigateEvents: new NavigateEvents(),
  });
  const started = await controller.start();
  return { app, hud, filters, popup, announcer, index, indexToggle, stage, tooltip, tooltipRoot, labels, controller, started, warnings };
}
