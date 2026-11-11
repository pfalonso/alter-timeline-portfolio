import { afterEach, describe, expect, it } from 'vitest';
import { FilterBar } from '../../../src/infrastructure/dom/FilterBar';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { cleanupDom, click, mount, unsafeModel } from '../../helpers/dom';
import { buildModel, fakeHandlers, makeData } from '../../helpers/fixtures';

afterEach(cleanupDom);

function setup(): { root: HTMLElement; bar: FilterBar; handlers: ReturnType<typeof fakeHandlers> } {
  const root = mount('nav');
  const bar = new FilterBar(root);
  const handlers = fakeHandlers();
  bar.bind(handlers);
  bar.render(buildModel());
  return { root, bar, handlers };
}

const chip = (root: HTMLElement, id: string): HTMLButtonElement => {
  const node = root.querySelector<HTMLButtonElement>(`button.chip[data-category="${id}"]`);
  if (!node) throw new Error(`no hay chip ${id}`);
  return node;
};
const bulk = (root: HTMLElement, label: string): HTMLButtonElement => {
  const node = [...root.querySelectorAll<HTMLButtonElement>('button.filters__bulk')].find((button) => button.textContent === label);
  if (!node) throw new Error(`no hay botón ${label}`);
  return node;
};

describe('FilterBar', () => {
  it('pinta un chip por categoría, en el orden de los datos, con etiqueta, icono, recuento y color', () => {
    const { root } = setup();
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe(STRINGS.filtersLabel);

    const chips = [...root.querySelectorAll<HTMLButtonElement>('button.chip')];
    expect(chips.map((node) => node.dataset.category)).toEqual(['work', 'study', 'play']);
    expect(chips.map((node) => node.querySelector('.chip__label')?.textContent)).toEqual(['Trabajo', 'Estudios', 'Juego']);
    // El evento privado (play) no cuenta mientras está oculto.
    expect(chips.map((node) => node.querySelector('.chip__count')?.textContent)).toEqual(['2', '2', '2']);
    expect(chips.map((node) => node.style.getPropertyValue('--chip-color'))).toEqual(['#FFB454', '#6EA8FF', '#B48CFF']);
    expect(chips.map((node) => node.querySelector('.chip__icon')?.textContent ?? null)).toEqual(['▲', null, '✦']);
    for (const node of chips) {
      expect(node.type).toBe('button');
      expect(node.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('el recuento incluye los privados cuando se muestran', () => {
    const root = mount('nav');
    new FilterBar(root).render(buildModel(makeData(), { includePrivate: true }));
    expect(chip(root, 'play').querySelector('.chip__count')?.textContent).toBe('3');
  });

  it('title: la descripción de la categoría o, si no tiene, la pista de uso', () => {
    const { root } = setup();
    expect(chip(root, 'work').title).toBe('Empleo');
    expect(chip(root, 'study').title).toBe(STRINGS.filterHint);
  });

  it('clic en un chip → alternar esa categoría', () => {
    const { root, handlers } = setup();
    click(chip(root, 'study'));
    expect(handlers.onCategoryToggled).toHaveBeenCalledExactlyOnceWith('study');
    expect(handlers.onCategorySoloed).not.toHaveBeenCalled();
  });

  it('Alt+clic o doble clic → solo esa categoría', () => {
    const { root, handlers } = setup();
    click(chip(root, 'play'), { altKey: true });
    click(chip(root, 'work'), { detail: 2 });
    expect(handlers.onCategorySoloed.mock.calls).toEqual([['play'], ['work']]);
    expect(handlers.onCategoryToggled).not.toHaveBeenCalled();
  });

  it('"Todas" y "Ninguna"', () => {
    const { root, handlers } = setup();
    click(bulk(root, STRINGS.all));
    click(bulk(root, STRINGS.none));
    expect(handlers.onAllCategories).toHaveBeenCalledTimes(1);
    expect(handlers.onNoCategories).toHaveBeenCalledTimes(1);
  });

  it('applyFilter refleja el estado en aria-pressed y desactiva el botón redundante', () => {
    const { root, bar } = setup();
    const state = (active: string[]): Parameters<FilterBar['applyFilter']>[0] => ({
      activeCategoryIds: new Set(active),
      visibleEventIds: new Set(),
      totalEvents: 4,
    });

    bar.applyFilter(state(['work', 'play']));
    expect(['work', 'study', 'play'].map((id) => chip(root, id).getAttribute('aria-pressed'))).toEqual(['true', 'false', 'true']);
    expect(bulk(root, STRINGS.all).disabled).toBe(false);
    expect(bulk(root, STRINGS.none).disabled).toBe(false);

    bar.applyFilter(state(['work', 'study', 'play']));
    expect(bulk(root, STRINGS.all).disabled).toBe(true);
    expect(bulk(root, STRINGS.none).disabled).toBe(false);

    bar.applyFilter(state([]));
    expect(bulk(root, STRINGS.all).disabled).toBe(false);
    expect(bulk(root, STRINGS.none).disabled).toBe(true);
    expect(root.querySelectorAll('.chip[aria-pressed="true"]')).toHaveLength(0);
  });

  it('sin handlers enlazados los clics no fallan; applyFilter antes de render tampoco', () => {
    const root = mount('nav');
    const bar = new FilterBar(root);
    expect(() => bar.applyFilter({ activeCategoryIds: new Set(), visibleEventIds: new Set(), totalEvents: 0 })).not.toThrow();
    bar.render(buildModel());
    expect(() => {
      click(chip(root, 'work'));
      click(chip(root, 'work'), { altKey: true });
      click(bulk(root, STRINGS.all));
      click(bulk(root, STRINGS.none));
    }).not.toThrow();
  });

  it('volver a pintar no duplica chips', () => {
    const { root, bar } = setup();
    bar.render(buildModel());
    expect(root.querySelectorAll('.chip')).toHaveLength(3);
    expect(root.querySelectorAll('.filters__bulk')).toHaveLength(2);
  });

  it('seguridad: etiquetas y descripciones con HTML se muestran como texto', () => {
    const root = mount('nav');
    const hostile = unsafeModel(buildModel(), {
      categories: [{ id: 'work', label: '<img src=x onerror=alert(1)>', color: '#FFB454', icon: '<b>!</b>', description: '"><script>x</script>' }],
    });
    new FilterBar(root).render(hostile);
    expect(root.querySelector('img, script, b')).toBeNull();
    expect(root.querySelector('.chip__label')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector<HTMLElement>('.chip')?.title).toBe('"><script>x</script>');
  });
});

describe('dominantStyles', () => {
  it('cada categoría toma el lenguaje de forma de la línea donde más eventos tiene', async () => {
    const { dominantStyles } = await import('../../../src/infrastructure/dom/FilterBar');
    const { TimelineFactory } = await import('../../../src/domain/services');
    const { makeData, NOW } = await import('../../helpers/fixtures');
    const data = makeData();
    data.branches = [{ id: 'side', label: 'Lado', style: 'organic' }];
    const timeline = new TimelineFactory().create(data, { now: NOW });
    const styles = dominantStyles(timeline);
    for (const category of timeline.categories) {
      const events = timeline.events.filter((event) => event.categoryIds.includes(category.id));
      if (events.length === 0) continue;
      expect(['organic', 'neutral']).toContain(styles.get(category.id));
    }
    expect([...styles.values()]).toContain('organic');
  });
});
