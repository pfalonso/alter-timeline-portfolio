import { describe, expect, it } from 'vitest';
import { arcYears, type LifeData } from '../../../src/domain/model';
import { BRIDGE_MAX, LifeDataValidator, TimelineFactory, TimelineLayout } from '../../../src/domain/services';
import { makeStoryData, NOW } from '../../helpers/fixtures';

const validator = new LifeDataValidator();
const issuesOf = (data: unknown): string[] =>
  validator.validate(data).issues.map((issue) => `${issue.path}: ${issue.message}`);
const timelineOf = (data: LifeData, includePrivate = false) =>
  new TimelineFactory().create(validator.assertValid(data), { now: NOW, includePrivate });

describe('Validación de arcos, historia y frases puente', () => {
  it('acepta arcos contiguos, un recorrido cronológico y puentes cortos', () => {
    expect(issuesOf(makeStoryData())).toEqual([]);
  });

  it('acepta arcos que se tocan en el mismo año y datos sin arcos ni historia', () => {
    const touching = makeStoryData((data) => {
      data.arcs = [
        { id: 'uno', title: 'Uno', start: '2010', end: '2014' },
        { id: 'dos', title: 'Dos', start: '2014', end: 'present' },
      ];
    });
    expect(issuesOf(touching)).toEqual([]);
    expect(
      issuesOf(
        makeStoryData((data) => {
          delete data.arcs;
          delete data.story;
        }),
      ),
    ).toEqual([]);
  });

  it('acumula los errores de los arcos con su ruta', () => {
    const data = makeStoryData((d) => {
      d.arcs = [
        { id: 'uno', title: 'Uno', start: '2010', end: '2016' },
        { id: 'uno', title: '', start: '2015', end: '2017' },
        { id: 'Mal', title: 'Fechas', start: '2020', end: '2019' },
        { id: 'sin-fin', title: 'Sin fin', start: '2021' } as never,
        { id: 'raro', title: 'Raro', start: 'ayer', end: 'present' },
      ];
    });
    const issues = issuesOf(data);
    expect(issues).toContain('arcs[1].id: id duplicado "uno"');
    expect(issues).toContain('arcs[1].title: es obligatorio y debe ser un texto no vacío');
    expect(issues.some((issue) => issue.startsWith('arcs[1].start: el arco "uno" se solapa con "uno"'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('arcs[2].id:'))).toBe(true);
    expect(issues).toContain('arcs[2].end: "2019" es anterior a start "2020"');
    expect(issues).toContain('arcs[3].end: es obligatorio (fecha o "present")');
    expect(issues.some((issue) => issue.startsWith('arcs[4].start:'))).toBe(true);
  });

  it('un arco que llega a "present" no admite otro posterior', () => {
    const issues = issuesOf(
      makeStoryData((d) => {
        d.arcs = [
          { id: 'hoy', title: 'Hoy', start: '2010', end: 'present' },
          { id: 'luego', title: 'Luego', start: '2018', end: '2019' },
        ];
      }),
    );
    expect(issues).toEqual(['arcs[1].start: el arco "luego" se solapa con "hoy" (que termina en "present")']);
  });

  it('arcs y story con forma incorrecta', () => {
    expect(issuesOf(makeStoryData((d) => Object.assign(d, { arcs: {} })))).toEqual([
      'arcs: debe ser una lista de arcos { id, title, start, end }',
    ]);
    expect(issuesOf(makeStoryData((d) => Object.assign(d, { arcs: [3] })))).toEqual([
      'arcs[0]: debe ser un objeto { id, title, start, end }',
    ]);
    expect(issuesOf(makeStoryData((d) => Object.assign(d, { story: [] })))).toEqual(['story: debe ser un objeto { title?, path }']);
    expect(issuesOf(makeStoryData((d) => Object.assign(d, { story: { title: 3 } })))).toEqual([
      'story.title: debe ser un texto',
      'story.path: es obligatorio y debe ser una lista de ids de eventos',
    ]);
  });

  it('story.path: ids existentes, sin repetir y en orden cronológico', () => {
    const issues = issuesOf(
      makeStoryData((d) => {
        d.story = { path: ['b-job', 'a-school', 'nadie', 'b-job', 7 as never, 'e-side-two'] };
      }),
    );
    expect(issues).toEqual([
      'story.path[1]: "a-school" (2010) es anterior a "b-job" (2015-03): el recorrido debe ir en orden cronológico',
      'story.path[2]: el evento "nadie" no existe',
      'story.path[3]: el evento "b-job" está repetido en el recorrido',
      'story.path[4]: debe ser el id de un evento',
    ]);
  });

  it(`bridge: texto no vacío de hasta ${BRIDGE_MAX} caracteres`, () => {
    const issues = issuesOf(
      makeStoryData((d) => {
        d.events[0].bridge = ' ';
        d.events[1].bridge = 'x'.repeat(BRIDGE_MAX + 1);
        d.events[2].bridge = 'x'.repeat(BRIDGE_MAX);
      }),
    );
    expect(issues).toEqual([
      'events[0].bridge: si se indica, debe ser un texto no vacío',
      `events[1].bridge: debe tener como máximo ${BRIDGE_MAX} caracteres (tiene ${BRIDGE_MAX + 1})`,
    ]);
  });
});

describe('Timeline: arcos y recorrido', () => {
  it('normaliza arcos (ordenados), el recorrido sin privados y las frases puente', () => {
    const timeline = timelineOf(makeStoryData((d) => d.arcs?.reverse()));
    expect(timeline.arcs.map((arc) => arc.id)).toEqual(['aprender', 'oficio', 'desvio']);
    expect(timeline.arcs[2].end).toBeNull();
    expect(timeline.storyTitle).toBe('La historia de Ada');
    expect(timeline.storyPath).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
    expect(timelineOf(makeStoryData(), true).storyPath).toContain('d-secret');
    expect(timeline.getEvent('b-job')?.bridge).toBe('Al salir de la escuela, el primer trabajo.');
    expect(timeline.getEvent('a-school')?.bridge).toBeUndefined();
  });

  it('arcOf asigna cada evento al capítulo que lo contiene (el posterior gana en la frontera)', () => {
    const timeline = timelineOf(
      makeStoryData((d) => {
        d.arcs = [
          { id: 'uno', title: 'Uno', start: '2010', end: '2015' },
          { id: 'dos', title: 'Dos', start: '2015', end: '2016' },
        ];
      }),
    );
    const arcOf = (id: string): string | undefined => timeline.arcOf(timeline.getEvent(id)!)?.id;
    expect(arcOf('a-school')).toBe('uno');
    expect(arcOf('b-job')).toBe('dos');
    expect(arcOf('c-side')).toBe('dos');
    expect(arcOf('e-side-two')).toBeUndefined();
    expect(timeline.arcAt(2009)).toBeUndefined();
    expect(timeline.getArc('dos')?.title).toBe('Dos');
    expect(timeline.getArc('nada')).toBeUndefined();
  });

  it('arcYears da el rango legible', () => {
    const timeline = timelineOf(makeStoryData());
    expect(timeline.arcs.map((arc) => arcYears(arc, 'hoy'))).toEqual(['2010 — 2014', '2015 — 2017', '2018 — hoy']);
    const single = timelineOf(makeStoryData((d) => (d.arcs = [{ id: 'a', title: 'A', start: '2012-03', end: '2012-09' }])));
    expect(arcYears(single.arcs[0], 'hoy')).toBe('2012');
  });

  it('el layout proyecta los arcos sobre el eje X', () => {
    const layout = new TimelineLayout().compute(timelineOf(makeStoryData()));
    expect(layout.arcs.map((arc) => arc.id)).toEqual(['aprender', 'oficio', 'desvio']);
    const [first, second, last] = layout.arcs;
    expect(first.endX).toBeGreaterThan(first.startX);
    expect(second.startX).toBeCloseTo(first.endX, 5); // "2014" termina justo cuando empieza 2015
    expect(last.endX).toBeGreaterThanOrEqual(layout.nowX);
    expect(new TimelineLayout().compute(timelineOf(makeStoryData((d) => delete d.arcs))).arcs).toEqual([]);
  });
});
