import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CategorySelection, PartialDate } from '../../src/domain/model';
import { EventFilter, LifeDataValidator, TimelineFactory, TimelineLayout } from '../../src/domain/services';

/** Tests de humo: comprueban que el dominio encaja de punta a punta con los datos de ejemplo. */
const example: unknown = JSON.parse(readFileSync('public/data/life.example.json', 'utf8'));
const now = new Date(Date.UTC(2026, 10, 10));

describe('PartialDate', () => {
  it('parsea las tres precisiones y rechaza lo demás', () => {
    expect(PartialDate.parse('2019').precision).toBe('year');
    expect(PartialDate.parse('2019-07').toDecimalYear()).toBeCloseTo(2019.5, 1);
    expect(PartialDate.parse('2019-07-15').toString()).toBe('2019-07-15');
    expect(PartialDate.tryParse('2019-13')).toBeNull();
    expect(PartialDate.tryParse('2019-02-30')).toBeNull();
    expect(() => PartialDate.parse('ayer')).toThrow();
  });
});

describe('LifeDataValidator', () => {
  const validator = new LifeDataValidator();

  it('acepta los datos de ejemplo', () => {
    const result = validator.validate(example);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('acumula todos los errores con su ruta', () => {
    const broken = structuredClone(example) as { events: Record<string, unknown>[]; categories: Record<string, unknown>[] };
    broken.categories[0].color = 'azul';
    broken.events[1].date = { start: '2014', end: '2010' };
    broken.events[2].categories = ['no-existe'];
    broken.events[3].branchFrom = 'fantasma';
    const paths = validator.validate(broken).issues.map((issue) => issue.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'categories[0].color',
        'events[1].date.end',
        'events[2].categories[0]',
        'events[3].branchFrom',
      ]),
    );
  });
});

describe('Timeline + layout + filtro', () => {
  const data = new LifeDataValidator().assertValid(example);
  const factory = new TimelineFactory();

  it('oculta los eventos privados salvo que se pidan', () => {
    const publicTimeline = factory.create(data, { now });
    const fullTimeline = factory.create(data, { now, includePrivate: true });
    expect(fullTimeline.events.length).toBe(publicTimeline.events.length + 1);
  });

  it('el layout es determinista, ordena X por fecha y desvía las ramas', () => {
    const timeline = factory.create(data, { now });
    const layout = new TimelineLayout().compute(timeline);
    expect(new TimelineLayout().compute(timeline)).toEqual(layout);
    expect(layout.nodes).toHaveLength(timeline.events.length);
    expect(layout.branches.map((branch) => branch.id).sort()).toEqual(['artes-visuales', 'cocina', 'creacion', 'ensenar', 'oficio']);
    expect(layout.branches.find((branch) => branch.main)?.id).toBe('oficio');

    const main = layout.nodes.filter((node) => node.branch === 'oficio');
    for (let i = 1; i < main.length; i += 1) expect(main[i].position.x).toBeGreaterThan(main[i - 1].position.x);
    // Los nodos viven en la banda central; las líneas laterales se alejan entre ellos.
    for (const node of layout.nodes) expect(Math.abs(node.position.y)).toBeLessThan(4);
    const side = layout.branches.find((branch) => branch.id === 'creacion');
    expect(Math.max(...(side?.points ?? []).map((point) => Math.abs(point.y)))).toBeGreaterThan(2);
  });

  it('filtra por categoría (basta con que una coincida)', () => {
    const timeline = factory.create(data, { now });
    const ids = timeline.categories.map((category) => category.id);
    const filter = new EventFilter();
    expect(filter.visibleEvents(timeline, CategorySelection.all(ids))).toHaveLength(timeline.events.length);
    expect(filter.visibleEvents(timeline, CategorySelection.none(ids))).toHaveLength(0);
    const onlyFood = filter.visibleEventIds(timeline, CategorySelection.all(ids).only('gastronomia'));
    expect([...onlyFood].sort()).toEqual(['cenas-sonoras', 'obrador-masa-lenta', 'recetario-autoeditado']);
  });
});
