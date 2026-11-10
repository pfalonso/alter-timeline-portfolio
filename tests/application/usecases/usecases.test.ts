import { describe, expect, it, vi } from 'vitest';
import {
  LoadTimeline,
  NavigateEvents,
  NO_SELECTION,
  SelectEvent,
  ToggleCategoryFilter,
} from '../../../src/application/usecases';
import { CategorySelection } from '../../../src/domain/model';
import { TimelineFactory, TimelineLayout } from '../../../src/domain/services';
import { InMemoryFilterStore, StubRepository } from '../../helpers/fakes';
import { makeData, NOW } from '../../helpers/fixtures';

const timeline = new TimelineFactory().create(makeData(), { now: NOW });
const ALL = new Set(timeline.events.map((event) => event.id)); // a-school, b-job, c-side, e-side-two
const IDS = ['work', 'study', 'play'];

describe('LoadTimeline', () => {
  it('carga del repositorio, construye el agregado con el reloj inyectado y calcula el layout', async () => {
    const repository = new StubRepository({ data: makeData(), source: 'example' });
    const clock = vi.fn(() => new Date(Date.UTC(2022, 4, 5)));
    const useCase = new LoadTimeline(repository, new TimelineFactory(), new TimelineLayout(), { includePrivate: false, clock });

    const model = await useCase.execute();

    expect(repository.calls).toBe(1);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(model.source).toBe('example');
    expect(model.timeline.now.toString()).toBe('2022-05-05');
    expect(model.timeline.events.map((event) => event.id)).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
    expect(model.layout).toEqual(new TimelineLayout().compute(model.timeline));
    expect(model.layout.nodes).toHaveLength(4);
  });

  it('includePrivate se propaga a la fábrica', async () => {
    const useCase = new LoadTimeline(
      new StubRepository({ data: makeData(), source: 'personal' }),
      new TimelineFactory(),
      new TimelineLayout(),
      { includePrivate: true, clock: () => NOW },
    );
    const model = await useCase.execute();
    expect(model.source).toBe('personal');
    expect(model.timeline.getEvent('d-secret')?.isPrivate).toBe(true);
    expect(model.layout.nodes).toHaveLength(5);
  });

  it('propaga el error del repositorio', async () => {
    const useCase = new LoadTimeline(new StubRepository(new Error('sin red')), new TimelineFactory(), new TimelineLayout(), {
      includePrivate: false,
      clock: () => NOW,
    });
    await expect(useCase.execute()).rejects.toThrow('sin red');
  });
});

describe('ToggleCategoryFilter', () => {
  it('toggle: alterna y persiste solo las activas', () => {
    const store = new InMemoryFilterStore();
    const useCase = new ToggleCategoryFilter(store);
    const next = useCase.execute(CategorySelection.all(IDS), { type: 'toggle', categoryId: 'study' });
    expect([...next.activeIds]).toEqual(['work', 'play']);
    expect(store.saved).toEqual([['work', 'play']]);
  });

  it('cuando vuelven a estar todas persiste null (URL limpia)', () => {
    const store = new InMemoryFilterStore();
    const useCase = new ToggleCategoryFilter(store);
    const next = useCase.execute(CategorySelection.all(IDS).toggle('study'), { type: 'toggle', categoryId: 'study' });
    expect(next.isAll).toBe(true);
    expect(store.saved).toEqual([null]);
  });

  it('only: deja solo esa; repetido sobre la única activa, vuelve a todas', () => {
    const store = new InMemoryFilterStore();
    const useCase = new ToggleCategoryFilter(store);
    const solo = useCase.execute(CategorySelection.all(IDS), { type: 'only', categoryId: 'play' });
    expect([...solo.activeIds]).toEqual(['play']);
    const back = useCase.execute(solo, { type: 'only', categoryId: 'play' });
    expect(back.isAll).toBe(true);
    const other = useCase.execute(solo, { type: 'only', categoryId: 'work' });
    expect([...other.activeIds]).toEqual(['work']);
    expect(store.saved).toEqual([['play'], null, ['work']]);
  });

  it('all / none', () => {
    const store = new InMemoryFilterStore();
    const useCase = new ToggleCategoryFilter(store);
    expect(useCase.execute(CategorySelection.all(IDS), { type: 'none' }).isNone).toBe(true);
    expect(useCase.execute(CategorySelection.none(IDS), { type: 'all' }).isAll).toBe(true);
    expect(store.saved).toEqual([[], null]);
  });

  it('una categoría desconocida no cambia el filtro (pero se persiste el estado actual)', () => {
    const store = new InMemoryFilterStore();
    const current = CategorySelection.all(IDS).toggle('work');
    expect(new ToggleCategoryFilter(store).execute(current, { type: 'toggle', categoryId: 'zzz' })).toBe(current);
    expect(store.saved).toEqual([['study', 'play']]);
  });
});

describe('SelectEvent', () => {
  const select = new SelectEvent();
  const focused = { focusedEventId: 'a-school', detailOpen: true };

  it('enfoca o abre un evento existente y visible', () => {
    expect(select.execute(timeline, ALL, NO_SELECTION, 'b-job', false)).toEqual({ focusedEventId: 'b-job', detailOpen: false });
    expect(select.execute(timeline, ALL, focused, 'b-job', true)).toEqual({ focusedEventId: 'b-job', detailOpen: true });
  });

  it('null suelta la selección', () => {
    expect(select.execute(timeline, ALL, focused, null, true)).toBe(NO_SELECTION);
  });

  it('un evento inexistente o filtrado deja la selección como estaba', () => {
    expect(select.execute(timeline, ALL, focused, 'fantasma', true)).toBe(focused);
    expect(select.execute(timeline, new Set(['a-school']), focused, 'b-job', true)).toBe(focused);
    // d-secret existe en los datos pero no en este Timeline (es privado).
    expect(select.execute(timeline, new Set(['d-secret']), focused, 'd-secret', true)).toBe(focused);
  });

  it('reconcile suelta la selección si el evento enfocado deja de ser visible', () => {
    expect(select.reconcile(new Set(['b-job']), focused)).toBe(NO_SELECTION);
    expect(select.reconcile(ALL, focused)).toBe(focused);
    expect(select.reconcile(new Set(), NO_SELECTION)).toBe(NO_SELECTION);
  });
});

describe('NavigateEvents', () => {
  const navigate = new NavigateEvents();

  it('sin selección: "next" va al primero y "previous" al último', () => {
    expect(navigate.execute(timeline, ALL, null, 'next')).toBe('a-school');
    expect(navigate.execute(timeline, ALL, null, 'previous')).toBe('e-side-two');
  });

  it('avanza y retrocede en orden cronológico cruzando ramas', () => {
    expect(navigate.execute(timeline, ALL, 'b-job', 'next')).toBe('c-side');
    expect(navigate.execute(timeline, ALL, 'c-side', 'previous')).toBe('b-job');
  });

  it('no da la vuelta en los extremos', () => {
    expect(navigate.execute(timeline, ALL, 'e-side-two', 'next')).toBe('e-side-two');
    expect(navigate.execute(timeline, ALL, 'a-school', 'previous')).toBe('a-school');
  });

  it('salta los eventos filtrados', () => {
    const visible = new Set(['a-school', 'e-side-two']);
    expect(navigate.execute(timeline, visible, 'a-school', 'next')).toBe('e-side-two');
    expect(navigate.execute(timeline, visible, 'e-side-two', 'previous')).toBe('a-school');
  });

  it('si el evento actual no es visible, empieza por un extremo', () => {
    const visible = new Set(['a-school', 'e-side-two']);
    expect(navigate.execute(timeline, visible, 'b-job', 'next')).toBe('a-school');
    expect(navigate.execute(timeline, visible, 'b-job', 'previous')).toBe('e-side-two');
  });

  it('sin eventos visibles no hay destino', () => {
    expect(navigate.execute(timeline, new Set(), null, 'next')).toBeNull();
    expect(navigate.execute(timeline, new Set(), 'b-job', 'previous')).toBeNull();
  });

  it('neighbours indica si hay vecino visible en cada sentido', () => {
    expect(navigate.neighbours(timeline, ALL, 'a-school')).toEqual({ hasPrevious: false, hasNext: true });
    expect(navigate.neighbours(timeline, ALL, 'b-job')).toEqual({ hasPrevious: true, hasNext: true });
    expect(navigate.neighbours(timeline, ALL, 'e-side-two')).toEqual({ hasPrevious: true, hasNext: false });
    expect(navigate.neighbours(timeline, ALL, null)).toEqual({ hasPrevious: true, hasNext: true });
    expect(navigate.neighbours(timeline, new Set(), null)).toEqual({ hasPrevious: false, hasNext: false });
    expect(navigate.neighbours(timeline, new Set(['b-job']), 'b-job')).toEqual({ hasPrevious: false, hasNext: false });
  });
});
