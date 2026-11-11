import { describe, expect, it } from 'vitest';
import { TimelineController } from '../../src/application/TimelineController';
import {
  FollowStory,
  LoadTimeline,
  MAJOR_STEP_IMPORTANCE,
  NavigateEvents,
  SelectEvent,
  ToggleCategoryFilter,
} from '../../src/application/usecases';
import type { LifeData } from '../../src/domain/model';
import { EventFilter, LifeDataValidator, TimelineFactory, TimelineLayout } from '../../src/domain/services';
import { InMemoryFilterStore, RecordingView, StubRepository } from '../helpers/fakes';
import { makeData, makeStoryData, NOW } from '../helpers/fixtures';

async function started(data: LifeData = makeStoryData(), includePrivate = false) {
  const view = new RecordingView();
  const store = new InMemoryFilterStore(null);
  const controller = new TimelineController({
    view,
    filterStore: store,
    eventFilter: new EventFilter(),
    loadTimeline: new LoadTimeline(new StubRepository({ data, source: 'personal' }), new TimelineFactory(), new TimelineLayout(), {
      includePrivate,
      clock: () => NOW,
    }),
    toggleCategoryFilter: new ToggleCategoryFilter(store),
    selectEvent: new SelectEvent(),
    navigateEvents: new NavigateEvents(),
  });
  await controller.start();
  return { controller, view };
}

const timelineOf = (data: LifeData) =>
  new TimelineFactory().create(new LifeDataValidator().assertValid(data), { now: NOW });
const ALL = new Set(['a-school', 'b-job', 'c-side', 'e-side-two']);

describe('NavigateEvents con granularidad', () => {
  const navigate = new NavigateEvents();
  const timeline = timelineOf(makeData());

  it(`«major» salta a la siguiente importancia ≥ ${MAJOR_STEP_IMPORTANCE} (c-side es menor)`, () => {
    expect(navigate.execute(timeline, ALL, 'b-job', 'next', 'major')).toBe('e-side-two');
    expect(navigate.execute(timeline, ALL, 'e-side-two', 'previous', 'major')).toBe('b-job');
    expect(navigate.execute(timeline, ALL, null, 'next', 'major')).toBe('a-school');
    expect(navigate.execute(timeline, ALL, null, 'previous', 'major')).toBe('e-side-two');
  });

  it('«major» sin más eventos importantes cae al vecino; «all» va nodo a nodo', () => {
    const onlyMinorAhead = new Set(['b-job', 'c-side']);
    expect(navigate.execute(timeline, onlyMinorAhead, 'b-job', 'next', 'major')).toBe('c-side');
    expect(navigate.execute(timeline, ALL, 'b-job', 'next', 'all')).toBe('c-side');
    expect(navigate.execute(timeline, ALL, 'b-job', 'next')).toBe('c-side');
  });
});

describe('FollowStory', () => {
  const story = new FollowStory();
  const timeline = timelineOf(makeStoryData());

  it('el recorrido se limita a los eventos visibles y conserva su orden', () => {
    expect(story.path(timeline, ALL)).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
    expect(story.path(timeline, new Set(['e-side-two', 'a-school']))).toEqual(['a-school', 'e-side-two']);
  });

  it('start, step y capítulos nuevos', () => {
    const path = story.path(timeline, ALL);
    expect(story.start(path)).toEqual({ index: 0, eventId: 'a-school' });
    expect(story.start(path, 'c-side')).toEqual({ index: 2, eventId: 'c-side' });
    expect(story.start(path, 'fuera')).toEqual({ index: 0, eventId: 'a-school' });
    expect(story.start([])).toBeNull();
    expect(story.step(path, 'b-job', 'next')).toEqual({ index: 2, eventId: 'c-side' });
    expect(story.step(path, 'b-job', 'previous')).toEqual({ index: 0, eventId: 'a-school' });
    expect(story.step(path, 'e-side-two', 'next')).toBeNull();
    expect(story.step(path, 'fuera', 'next')).toBeNull();
    expect(story.step(path, null, 'next')).toBeNull();
    expect(story.isNewChapter(timeline, null, 'a-school')).toBe(true);
    expect(story.isNewChapter(timeline, 'a-school', 'b-job')).toBe(true);
    expect(story.isNewChapter(timeline, 'b-job', 'c-side')).toBe(false);
    const noArcs = timelineOf(makeStoryData((d) => delete d.arcs));
    expect(story.isNewChapter(noArcs, null, 'a-school')).toBe(false);
  });
});

describe('TimelineController: modo historia', () => {
  it('entra, avanza y retrocede por el recorrido con el detalle abierto', async () => {
    const { controller, view } = await started();
    controller.onStoryStart();
    expect(view.lastSelection).toMatchObject({
      focusedEventId: 'a-school',
      detailOpen: true,
      hasPrevious: false,
      hasNext: true,
      story: { index: 0, total: 4, eventId: 'a-school', fromEventId: null, arcId: 'aprender', newChapter: true },
    });
    controller.onStoryStep('next');
    expect(view.lastSelection.story).toEqual({
      index: 1,
      total: 4,
      eventId: 'b-job',
      fromEventId: 'a-school',
      arcId: 'oficio',
      newChapter: true,
    });
    // ←/→ en modo historia siguen el recorrido.
    controller.onNavigate('next', 'major');
    expect(view.lastSelection.story).toMatchObject({ index: 2, eventId: 'c-side', newChapter: false });
    controller.onNavigate('previous');
    expect(view.lastSelection.story).toMatchObject({ index: 1, eventId: 'b-job', fromEventId: 'c-side' });
  });

  it('no pasa de los extremos y sale con onStoryExit (cierra el detalle)', async () => {
    const { controller, view } = await started();
    controller.onStoryStart('e-side-two');
    const before = view.count('selection');
    controller.onStoryStep('next');
    expect(view.count('selection')).toBe(before);
    expect(view.lastSelection).toMatchObject({ hasNext: false, hasPrevious: true });
    controller.onStoryExit();
    expect(view.lastSelection).toMatchObject({ focusedEventId: 'e-side-two', detailOpen: false });
    expect(view.lastSelection.story).toBeUndefined();
    controller.onStoryExit();
    expect(view.lastSelection.story).toBeUndefined();
  });

  it('fuera del modo historia ofrece el siguiente del recorrido y onStoryStep entra desde ahí', async () => {
    const { controller, view } = await started();
    controller.onEventActivated('b-job');
    expect(view.lastSelection.storyNextId).toBe('c-side');
    controller.onStoryStep('next');
    expect(view.lastSelection.story).toMatchObject({ eventId: 'c-side', fromEventId: 'b-job' });
    controller.onStoryExit();
    controller.onEventActivated('e-side-two');
    expect(view.lastSelection.storyNextId).toBeUndefined();
  });

  it('elegir otro evento: si está en el recorrido sigue desde él; si no, sale', async () => {
    const data = makeStoryData((d) => (d.story = { path: ['a-school', 'e-side-two'] }));
    const { controller, view } = await started(data);
    controller.onStoryStart();
    controller.onEventActivated('e-side-two');
    expect(view.lastSelection.story).toMatchObject({ index: 1, eventId: 'e-side-two', fromEventId: 'a-school' });
    controller.onEventActivated('b-job');
    expect(view.lastSelection.story).toBeUndefined();
    expect(view.lastSelection.focusedEventId).toBe('b-job');
  });

  it('cerrar el detalle o soltar la selección sale de la historia', async () => {
    const { controller, view } = await started();
    controller.onStoryStart();
    controller.onDetailClosed();
    expect(view.lastSelection.story).toBeUndefined();
    controller.onStoryStart();
    controller.onSelectionCleared();
    expect(view.lastSelection).toMatchObject({ focusedEventId: null, detailOpen: false });
    expect(view.lastSelection.story).toBeUndefined();
  });

  it('el filtro acorta el recorrido y sale si oculta el paso actual', async () => {
    const { controller, view } = await started();
    controller.onStoryStart();
    controller.onCategoryToggled('play'); // oculta c-side; e-side-two sigue (también es work)
    controller.onStoryStep('next');
    controller.onStoryStep('next');
    expect(view.lastSelection.story).toMatchObject({ eventId: 'e-side-two', total: 3 });
    controller.onCategoryToggled('work');
    controller.onCategoryToggled('play');
    expect(view.lastSelection.story).toBeUndefined();
  });

  it('sin recorrido (o antes de cargar) no hace nada', async () => {
    const { controller, view } = await started(makeData());
    const before = view.count('selection');
    controller.onStoryStart();
    controller.onStoryStep('next');
    expect(view.count('selection')).toBe(before);
    const idle = new TimelineController({
      view: new RecordingView(),
      filterStore: new InMemoryFilterStore(),
      eventFilter: new EventFilter(),
      loadTimeline: new LoadTimeline(new StubRepository('x'), new TimelineFactory(), new TimelineLayout(), { includePrivate: false, clock: () => NOW }),
      toggleCategoryFilter: new ToggleCategoryFilter(new InMemoryFilterStore()),
      selectEvent: new SelectEvent(),
      navigateEvents: new NavigateEvents(),
    });
    expect(() => {
      idle.onStoryStart();
      idle.onStoryStep('next');
    }).not.toThrow();
  });
});
