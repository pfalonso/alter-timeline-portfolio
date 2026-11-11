import { describe, expect, it } from 'vitest';
import { TimelineController } from '../../src/application/TimelineController';
import { LoadTimeline, NavigateEvents, SelectEvent, ToggleCategoryFilter } from '../../src/application/usecases';
import type { LifeData } from '../../src/domain/model';
import { EventFilter, TimelineFactory, TimelineLayout } from '../../src/domain/services';
import { InMemoryFilterStore, RecordingView, StubRepository } from '../helpers/fakes';
import { makeData, NOW } from '../helpers/fixtures';

interface Harness {
  readonly controller: TimelineController;
  readonly view: RecordingView;
  readonly store: InMemoryFilterStore;
  readonly repository: StubRepository;
}

/** Controlador real + casos de uso reales, con puertos falsos (vista, repositorio y almacén). */
function harness(options: { stored?: string[] | null; data?: LifeData | Error | string; includePrivate?: boolean } = {}): Harness {
  const view = new RecordingView();
  const store = new InMemoryFilterStore(options.stored ?? null);
  const result = options.data ?? makeData();
  const repository = new StubRepository(
    result instanceof Error || typeof result === 'string' ? result : { data: result, source: 'personal' },
  );
  const controller = new TimelineController({
    view,
    filterStore: store,
    eventFilter: new EventFilter(),
    loadTimeline: new LoadTimeline(repository, new TimelineFactory(), new TimelineLayout(), {
      includePrivate: options.includePrivate ?? false,
      clock: () => NOW,
    }),
    toggleCategoryFilter: new ToggleCategoryFilter(store),
    selectEvent: new SelectEvent(),
    navigateEvents: new NavigateEvents(),
  });
  return { controller, view, store, repository };
}

async function started(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = harness(options);
  await h.controller.start();
  return h;
}

const ids = (set: ReadonlySet<string>): string[] => [...set].sort();

describe('TimelineController.start', () => {
  it('enlaza la vista, pinta el modelo y empuja filtro y selección iniciales, en ese orden', async () => {
    const { controller, view } = harness();
    await expect(controller.start()).resolves.toBe(true);

    expect(view.types).toEqual(['bind', 'render', 'filter', 'selection']);
    expect(view.handlers).toBe(controller);
    const render = view.calls[1];
    if (render.type !== 'render') throw new Error('se esperaba render');
    expect(render.model.source).toBe('personal');
    expect(render.model.timeline.events).toHaveLength(4);
    expect(ids(view.lastFilter.activeCategoryIds)).toEqual(['play', 'study', 'work']);
    expect(ids(view.lastFilter.visibleEventIds)).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
    expect(view.lastFilter.totalEvents).toBe(4);
    expect(view.lastSelection).toEqual({ focusedEventId: null, detailOpen: false, hasPrevious: true, hasNext: true });
  });

  it('restaura el filtro guardado (ignorando ids desconocidos)', async () => {
    const { view, store } = await started({ stored: ['work', 'zzz'] });
    expect(ids(view.lastFilter.activeCategoryIds)).toEqual(['work']);
    expect(ids(view.lastFilter.visibleEventIds)).toEqual(['b-job', 'e-side-two']);
    expect(view.lastFilter.totalEvents).toBe(4);
    expect(store.saved).toEqual([]);
    // Eje ordinal: el layout del filtro solo coloca los visibles, con paso constante.
    expect(view.lastFilter.layout?.nodes.map((node) => [node.eventId, node.index])).toEqual([
      ['b-job', 0],
      ['e-side-two', 1],
    ]);
  });

  it('un filtro guardado vacío significa "ninguna"', async () => {
    const { view } = await started({ stored: [] });
    expect(view.lastFilter.activeCategoryIds.size).toBe(0);
    expect(view.lastFilter.visibleEventIds.size).toBe(0);
    expect(view.lastSelection).toMatchObject({ hasPrevious: false, hasNext: false });
  });

  it('los eventos privados cuentan en el total solo si se piden', async () => {
    expect((await started()).view.lastFilter.totalEvents).toBe(4);
    expect((await started({ includePrivate: true })).view.lastFilter.totalEvents).toBe(5);
  });

  it('si la carga falla muestra el error y devuelve false sin pintar nada más', async () => {
    const { controller, view } = harness({ data: new Error('No se han podido cargar los datos') });
    await expect(controller.start()).resolves.toBe(false);
    expect(view.calls).toEqual([{ type: 'bind' }, { type: 'error', message: 'No se han podido cargar los datos' }]);
  });

  it('un rechazo que no es Error se convierte a texto', async () => {
    const { controller, view } = harness({ data: 'fallo raro' });
    await expect(controller.start()).resolves.toBe(false);
    expect(view.calls.at(-1)).toEqual({ type: 'error', message: 'fallo raro' });
  });

  it('antes de cargar (o tras un fallo) las intenciones del usuario se ignoran', async () => {
    const { controller, view, store } = harness({ data: new Error('x') });
    const poke = (): void => {
      controller.onCategoryToggled('work');
      controller.onCategorySoloed('work');
      controller.onAllCategories();
      controller.onNoCategories();
      controller.onEventActivated('a-school');
      controller.onNavigate('next');
      controller.onSelectionCleared();
      controller.onDetailClosed();
    };
    poke();
    expect(view.calls).toEqual([]);
    await controller.start();
    const afterFailure = view.calls.length;
    poke();
    expect(view.calls).toHaveLength(afterFailure);
    expect(store.saved).toEqual([]);
  });
});

describe('TimelineController: filtro', () => {
  it('alternar una categoría actualiza la vista y persiste', async () => {
    const { controller, view, store } = await started();
    controller.onCategoryToggled('play');
    expect(ids(view.lastFilter.activeCategoryIds)).toEqual(['study', 'work']);
    expect(ids(view.lastFilter.visibleEventIds)).toEqual(['a-school', 'b-job', 'e-side-two']);
    expect(store.saved).toEqual([['work', 'study']]);
    controller.onCategoryToggled('play');
    expect(view.lastFilter.visibleEventIds.size).toBe(4);
    expect(store.saved.at(-1)).toBeNull();
  });

  it('"solo esta" y, repetido, vuelta a todas', async () => {
    const { controller, view, store } = await started();
    controller.onCategorySoloed('study');
    expect(ids(view.lastFilter.activeCategoryIds)).toEqual(['study']);
    expect(ids(view.lastFilter.visibleEventIds)).toEqual(['a-school', 'b-job']);
    controller.onCategorySoloed('study');
    expect(view.lastFilter.activeCategoryIds.size).toBe(3);
    expect(store.saved).toEqual([['study'], null]);
  });

  it('ninguna / todas', async () => {
    const { controller, view, store } = await started();
    controller.onNoCategories();
    expect(view.lastFilter).toMatchObject({ totalEvents: 4 });
    expect(view.lastFilter.visibleEventIds.size).toBe(0);
    expect(view.lastSelection).toMatchObject({ hasPrevious: false, hasNext: false });
    controller.onAllCategories();
    expect(view.lastFilter.visibleEventIds.size).toBe(4);
    expect(store.saved).toEqual([[], null]);
  });

  it('cada cambio de filtro empuja filtro y después selección', async () => {
    const { controller, view } = await started();
    const before = view.calls.length;
    controller.onCategoryToggled('work');
    expect(view.types.slice(before)).toEqual(['filter', 'selection']);
  });

  it('si el filtro oculta el evento abierto, se cierra y se suelta el foco', async () => {
    const { controller, view } = await started();
    controller.onEventActivated('c-side');
    expect(view.lastSelection).toMatchObject({ focusedEventId: 'c-side', detailOpen: true });
    controller.onCategoryToggled('play');
    expect(view.lastSelection).toEqual({ focusedEventId: null, detailOpen: false, hasPrevious: true, hasNext: true });
  });

  it('si el evento abierto sigue visible tras filtrar, se conserva y se recalculan los vecinos', async () => {
    const { controller, view } = await started();
    controller.onEventActivated('b-job');
    expect(view.lastSelection).toMatchObject({ hasPrevious: true, hasNext: true });
    controller.onCategorySoloed('work'); // quedan b-job y e-side-two
    expect(view.lastSelection).toEqual({ focusedEventId: 'b-job', detailOpen: true, hasPrevious: false, hasNext: true });
  });
});

describe('TimelineController: selección y navegación', () => {
  it('activar un evento abre su detalle con los vecinos correctos', async () => {
    const { controller, view } = await started();
    controller.onEventActivated('a-school');
    expect(view.lastSelection).toEqual({ focusedEventId: 'a-school', detailOpen: true, hasPrevious: false, hasNext: true });
    controller.onEventActivated('e-side-two');
    expect(view.lastSelection).toEqual({ focusedEventId: 'e-side-two', detailOpen: true, hasPrevious: true, hasNext: false });
  });

  it('activar un evento inexistente, privado oculto o filtrado no cambia nada', async () => {
    const { controller, view } = await started();
    controller.onCategoryToggled('play');
    const before = view.calls.length;
    controller.onEventActivated('fantasma');
    controller.onEventActivated('d-secret');
    controller.onEventActivated('c-side');
    expect(view.calls).toHaveLength(before);
  });

  it('activar dos veces el mismo evento no repinta', async () => {
    const { controller, view } = await started();
    controller.onEventActivated('b-job');
    const before = view.count('selection');
    controller.onEventActivated('b-job');
    expect(view.count('selection')).toBe(before);
  });

  it('cerrar el detalle conserva el foco; cerrar sin detalle abierto no hace nada', async () => {
    const { controller, view } = await started();
    controller.onDetailClosed();
    expect(view.count('selection')).toBe(1);
    controller.onEventActivated('b-job');
    controller.onDetailClosed();
    expect(view.lastSelection).toMatchObject({ focusedEventId: 'b-job', detailOpen: false });
    controller.onDetailClosed();
    expect(view.count('selection')).toBe(3);
  });

  it('soltar la selección lo cierra todo', async () => {
    const { controller, view } = await started();
    controller.onEventActivated('b-job');
    controller.onSelectionCleared();
    expect(view.lastSelection).toMatchObject({ focusedEventId: null, detailOpen: false });
    const before = view.count('selection');
    controller.onSelectionCleared();
    expect(view.count('selection')).toBe(before);
  });

  it('navegar sin selección enfoca (sin abrir) el primero o el último', async () => {
    const first = await started();
    first.controller.onNavigate('next');
    expect(first.view.lastSelection).toEqual({ focusedEventId: 'a-school', detailOpen: false, hasPrevious: false, hasNext: true });
    const last = await started();
    last.controller.onNavigate('previous');
    expect(last.view.lastSelection).toMatchObject({ focusedEventId: 'e-side-two', detailOpen: false, hasNext: false });
  });

  it('navegar con el detalle abierto lo mantiene abierto en el evento vecino', async () => {
    const { controller, view } = await started();
    controller.onEventActivated('b-job');
    controller.onNavigate('next');
    expect(view.lastSelection).toMatchObject({ focusedEventId: 'c-side', detailOpen: true });
    controller.onNavigate('previous');
    controller.onNavigate('previous');
    expect(view.lastSelection).toMatchObject({ focusedEventId: 'a-school', detailOpen: true, hasPrevious: false });
  });

  it('en los extremos no da la vuelta ni repinta', async () => {
    const { controller, view } = await started();
    controller.onEventActivated('e-side-two');
    const before = view.count('selection');
    controller.onNavigate('next');
    expect(view.count('selection')).toBe(before);
    expect(view.lastSelection.focusedEventId).toBe('e-side-two');
  });

  it('la navegación salta los eventos filtrados', async () => {
    const { controller, view } = await started();
    controller.onCategorySoloed('work'); // b-job y e-side-two
    controller.onNavigate('next');
    expect(view.lastSelection.focusedEventId).toBe('b-job');
    controller.onNavigate('next');
    expect(view.lastSelection.focusedEventId).toBe('e-side-two');
  });

  it('sin eventos visibles la navegación no hace nada', async () => {
    const { controller, view } = await started({ stored: [] });
    const before = view.calls.length;
    controller.onNavigate('next');
    controller.onNavigate('previous');
    expect(view.calls).toHaveLength(before);
  });
});
