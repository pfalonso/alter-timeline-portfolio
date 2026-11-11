import { afterEach, describe, expect, it } from 'vitest';
import type { StoryViewState } from '../../../src/application/ports';
import { ArcStrip, ARC_CAPTION_MIN_WIDTH } from '../../../src/infrastructure/dom/ArcStrip';
import { EventList } from '../../../src/infrastructure/dom/EventList';
import { EventPopup } from '../../../src/infrastructure/dom/EventPopup';
import { LiveAnnouncer } from '../../../src/infrastructure/dom/LiveAnnouncer';
import { StoryControls } from '../../../src/infrastructure/dom/StoryControls';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import type { ProjectedArc } from '../../../src/infrastructure/three/types';
import { cleanupDom, click, mount, texts, translation, unsafeModel } from '../../helpers/dom';
import { buildModel, fakeHandlers, makeData, makeStoryData, selection } from '../../helpers/fixtures';

afterEach(cleanupDom);

const model = buildModel(makeStoryData());
const story = (eventId: string, overrides: Partial<StoryViewState> = {}): StoryViewState => ({
  index: 1,
  total: 4,
  eventId,
  fromEventId: 'a-school',
  arcId: 'oficio',
  newChapter: false,
  ...overrides,
});

describe('ArcStrip', () => {
  const frame = (arcs: ProjectedArc[]) => ({ nodes: [], years: [], nowX: null, cameraDistance: 40, viewport: { width: 1000, height: 600 }, arcs });

  it('un segmento por capítulo con título y años; sin arcos, oculta', () => {
    const root = mount('div');
    const strip = new ArcStrip(root);
    strip.render(model);
    expect(root.hidden).toBe(false);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(texts(root, '.arc-strip__title')).toEqual(['Aprender', 'Oficio', 'Desvío']);
    expect(texts(root, '.arc-strip__years')).toEqual(['2010 — 2014', '2015 — 2017', `2018 — ${STRINGS.today}`]);
    strip.render(buildModel(makeData()));
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it('coloca cada segmento en la parte visible, ilumina el activo y oculta el título si no cabe', () => {
    const root = mount('div');
    const strip = new ArcStrip(root);
    strip.render(model);
    strip.onProjected(
      frame([
        { id: 'aprender', startX: -300, endX: 200, active: false },
        { id: 'oficio', startX: 200, endX: 200 + ARC_CAPTION_MIN_WIDTH - 10, active: true },
        { id: 'desvio', startX: 1200, endX: 1500, active: false },
        { id: 'fantasma', startX: 0, endX: 100, active: false },
      ]),
    );
    const [first, second, third] = [...root.querySelectorAll<HTMLElement>('.arc-strip__segment')];
    expect(translation(first)[0]).toBe(8);
    expect(first.style.width).toBe('192px');
    expect(first.classList.contains('arc-strip__segment--active')).toBe(false);
    expect(second.classList.contains('arc-strip__segment--active')).toBe(true);
    expect(second.querySelector<HTMLElement>('.arc-strip__caption')?.hidden).toBe(true);
    expect(first.querySelector<HTMLElement>('.arc-strip__caption')?.hidden).toBe(false);
    expect(third.hidden).toBe(true);
    strip.onProjected({ ...frame([]), arcs: undefined });
  });
});

describe('StoryControls', () => {
  function setup(data = makeStoryData()) {
    const app = mount('div');
    const button = mount('button');
    const card = mount('section');
    const popup = mount('aside');
    popup.tabIndex = -1;
    const controls = new StoryControls(button, card, { app, focusAfterCard: () => popup });
    const handlers = fakeHandlers();
    controls.bind(handlers);
    controls.render(buildModel(data));
    return { app, button, card, popup, controls, handlers };
  }

  it('el botón solo aparece si hay recorrido y alterna entrar/salir', () => {
    const { button, handlers, controls, app } = setup();
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe(STRINGS.storyStart);
    click(button);
    expect(handlers.onStoryStart).toHaveBeenCalledTimes(1);
    controls.applySelection({ ...selection('b-job', true), story: story('b-job') });
    expect(button.textContent).toBe(STRINGS.storyExit);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(app.classList.contains('app--story')).toBe(true);
    click(button);
    expect(handlers.onStoryExit).toHaveBeenCalledTimes(1);
    controls.applySelection(selection('b-job'));
    expect(app.classList.contains('app--story')).toBe(false);
    expect(setup(makeData()).button.hidden).toBe(true);
  });

  it('tarjeta de capítulo al entrar en un arco nuevo; se pasa con Continuar o con el siguiente paso', () => {
    const { card, controls, popup } = setup();
    controls.applySelection({ ...selection('b-job', true), story: story('b-job', { newChapter: true }) });
    expect(controls.cardVisible).toBe(true);
    expect(texts(card, '.chapter__kicker')).toEqual([`${STRINGS.chapterOf(1, 3)} · 2015 — 2017`]);
    expect(texts(card, '.chapter__title')).toEqual(['Oficio']);
    expect(card.querySelector('.chapter__summary')).toBeNull();
    expect(card.getAttribute('aria-live')).toBe('polite');
    // Reaplicar el mismo paso (p. ej. tras un filtro) no la vuelve a mostrar.
    click(card.querySelector('.chapter__continue') as HTMLElement);
    expect(controls.cardVisible).toBe(false);
    expect(document.activeElement).toBe(popup);
    controls.applySelection({ ...selection('b-job', true), story: story('b-job', { newChapter: true }) });
    expect(controls.cardVisible).toBe(false);
    // Otro capítulo con resumen y subtítulo; después, un paso sin capítulo nuevo la pasa.
    controls.applySelection({ ...selection('a-school', true), story: story('a-school', { arcId: 'aprender', newChapter: true }) });
    expect(texts(card, '.chapter__subtitle')).toEqual(['La escuela']);
    expect(texts(card, '.chapter__summary')).toEqual(['Años de estudio.']);
    controls.applySelection({ ...selection('c-side', true), story: story('c-side') });
    expect(controls.cardVisible).toBe(false);
    controls.applySelection({ ...selection('e-side-two', true), story: story('e-side-two', { arcId: 'desvio', newChapter: true }) });
    expect(controls.cardVisible).toBe(true);
    controls.applySelection(selection('e-side-two'));
    expect(controls.cardVisible).toBe(false);
  });

  it('un arco desconocido no muestra tarjeta', () => {
    const { controls } = setup();
    controls.applySelection({ ...selection('b-job', true), story: story('b-job', { arcId: 'nada', newChapter: true }) });
    expect(controls.cardVisible).toBe(false);
  });
});

describe('EventPopup en modo historia', () => {
  function setup() {
    const root = mount('aside');
    const popup = new EventPopup(root);
    const handlers = fakeHandlers();
    popup.bind(handlers);
    popup.render(model);
    return { root, popup, handlers };
  }

  it('progreso «2 / 4», capítulo, frase puente y salida', () => {
    const { root, popup, handlers } = setup();
    popup.applySelection({ ...selection('b-job', true), story: story('b-job') });
    expect(root.classList.contains('popup--story')).toBe(true);
    expect(texts(root, '.popup__step')).toEqual(['2 / 4']);
    expect(root.querySelector('.popup__step')?.getAttribute('aria-label')).toBe('Paso 2 de 4');
    expect(texts(root, '.popup__arc')).toEqual(['Oficio']);
    expect(texts(root, '.popup__bridge')).toEqual(['Al salir de la escuela, el primer trabajo.']);
    const exit = root.querySelector<HTMLButtonElement>('.popup__exit-story') as HTMLButtonElement;
    expect(exit.hidden).toBe(false);
    click(exit);
    expect(handlers.onStoryExit).toHaveBeenCalledTimes(1);
    expect((root.querySelector('.popup__story-next') as HTMLElement).hidden).toBe(true);
    // Sin frase puente ni arco: solo el progreso.
    popup.applySelection({ ...selection('c-side', true), story: story('c-side', { index: 2, arcId: null }) });
    expect(texts(root, '.popup__step')).toEqual(['3 / 4']);
    expect(root.querySelector('.popup__bridge')).toBeNull();
    expect(root.querySelector('.popup__arc')).toBeNull();
  });

  it('fuera de la historia: insignia del capítulo y enlace «Siguiente en la historia»', () => {
    const { root, popup, handlers } = setup();
    popup.applySelection({ ...selection('b-job', true), storyNextId: 'c-side' });
    expect(root.classList.contains('popup--story')).toBe(false);
    expect((root.querySelector('.popup__story') as HTMLElement).hidden).toBe(true);
    expect(root.querySelector('.popup__bridge')).toBeNull();
    expect(texts(root, '.badge--arc')).toEqual([STRINGS.arcOf('Oficio')]);
    const next = root.querySelector<HTMLButtonElement>('.popup__story-next') as HTMLButtonElement;
    expect(next.hidden).toBe(false);
    click(next);
    expect(handlers.onStoryStep).toHaveBeenCalledWith('next');
    popup.applySelection(selection('e-side-two', true));
    expect(next.hidden).toBe(true);
  });
});

describe('EventList agrupado por capítulos', () => {
  it('un grupo por arco, en orden, con título y años; lo que cae fuera va a «Otros momentos»', () => {
    const root = mount('nav');
    const list = new EventList(root);
    list.render(
      buildModel(
        makeStoryData((d) => {
          d.arcs = [{ id: 'oficio', title: 'Oficio', start: '2015', end: '2017' }];
        }),
      ),
    );
    expect(texts(root, '.index__group-title > span:first-child')).toEqual([STRINGS.outsideArcs, 'Oficio', STRINGS.outsideArcs]);
    const groups = [...root.querySelectorAll<HTMLElement>('.index__group')];
    expect(groups.map((group) => group.querySelectorAll('.index__item').length)).toEqual([1, 2, 1]);
    expect(groups[1].dataset.arc).toBe('oficio');
    expect(texts(root, '.index__group-years')).toEqual(['2015 — 2017']);
    expect(root.querySelector('.index__item--i3 .index__name')?.textContent).toBe('Primer trabajo');
  });

  it('sin arcos, la lista sigue siendo plana', () => {
    const root = mount('nav');
    new EventList(root).render(buildModel(makeData()));
    expect(root.querySelector('.index__group')).toBeNull();
  });
});

describe('LiveAnnouncer en modo historia', () => {
  it('anuncia el paso, el capítulo y la frase puente antes del evento', () => {
    const root = mount('div');
    const announcer = new LiveAnnouncer(root);
    announcer.render(model);
    announcer.applySelection({ ...selection('b-job', true), story: story('b-job') });
    expect(root.textContent).toMatch(/^Paso 2 de 4\. Capítulo: Oficio\. Al salir de la escuela, el primer trabajo\. Primer trabajo\./);
    announcer.applySelection({ ...selection('c-side', true), story: story('c-side', { arcId: null }) });
    expect(root.textContent).toMatch(/^Paso 2 de 4\. Proyecto paralelo\./);
  });
});

describe('modelo hostil', () => {
  it('la frase puente se pinta como texto', () => {
    const root = mount('aside');
    const popup = new EventPopup(root);
    popup.render(unsafeModel(model, { events: { 'b-job': { bridge: '<img src=x onerror=alert(1)>' } } }));
    popup.applySelection({ ...selection('b-job', true), story: story('b-job') });
    expect(root.querySelector('img')).toBeNull();
    expect(texts(root, '.popup__bridge')).toEqual(['<img src=x onerror=alert(1)>']);
  });
});
