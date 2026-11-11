import { describe, expect, it } from 'vitest';
import type { LifeData } from '../../../src/domain/model';
import {
  DEFAULT_LAYOUT_OPTIONS,
  TimelineFactory,
  TimelineLayout,
  type LayoutOptions,
  type TimelineLayoutResult,
} from '../../../src/domain/services';
import { makeData, makeEvent, makeLifeLinesData, NOW } from '../../helpers/fixtures';

const O = DEFAULT_LAYOUT_OPTIONS;
const STEP = O.nodeStep;

function timelineOf(data: LifeData, includePrivate = false) {
  return new TimelineFactory().create(data, { now: NOW, includePrivate });
}

function layoutOf(data: LifeData, options: Partial<LayoutOptions> = {}, includePrivate = false): TimelineLayoutResult {
  return new TimelineLayout(options).compute(timelineOf(data, includePrivate));
}

function nodeOf(layout: TimelineLayoutResult, id: string): TimelineLayoutResult['nodes'][number] {
  const node = layout.nodes.find((item) => item.eventId === id);
  if (!node) throw new Error(`no hay nodo ${id}`);
  return node;
}

function branchOf(layout: TimelineLayoutResult, id: string): TimelineLayoutResult['branches'][number] {
  const branch = layout.branches.find((item) => item.id === id);
  if (!branch) throw new Error(`no hay rama ${id}`);
  return branch;
}

/** Datos con solo los eventos indicados (categoría `work`). */
function dataWith(events: LifeData['events']): LifeData {
  return { ...makeData(), events };
}

/** Y de una polilínea en una X (interpolación lineal entre muestras). */
function yAt(points: readonly { x: number; y: number }[], x: number): number {
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].x >= x) {
      const a = points[i - 1];
      const b = points[i];
      return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return points[points.length - 1].y;
}

/** Una línea vital con nodos muy separados entre muchos nodos de la central. */
function sparseData(): LifeData {
  const events: LifeData['events'] = [];
  for (let year = 2000; year <= 2012; year += 1) events.push(makeEvent({ id: `m${year}`, date: { start: String(year) } }));
  events.push(makeEvent({ id: 's1', date: { start: '2001-06' }, branch: 'side', branchFrom: 'm2000' }));
  events.push(makeEvent({ id: 's2', date: { start: '2010-06' }, branch: 'side' }));
  return dataWith(events);
}

describe('TimelineLayout: determinismo', () => {
  it('el mismo Timeline produce exactamente el mismo resultado', () => {
    const a = layoutOf(makeData());
    const b = layoutOf(makeData());
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('no depende del orden de los eventos en el JSON', () => {
    const shuffled = makeData();
    shuffled.events.reverse();
    expect(layoutOf(shuffled)).toEqual(layoutOf(makeData()));
    const lines = makeLifeLinesData();
    const reversed = makeLifeLinesData((data) => data.events.reverse());
    expect(layoutOf(reversed)).toEqual(layoutOf(lines));
  });

  it('las coordenadas están redondeadas a milésimas (sin ruido de coma flotante)', () => {
    const layout = layoutOf(makeLifeLinesData());
    const points = [...layout.nodes.map((node) => node.position), ...layout.branches.flatMap((branch) => branch.points)];
    for (const point of points) {
      for (const value of [point.x, point.y, point.z]) expect(Math.abs(value * 1000 - Math.round(value * 1000))).toBeLessThan(1e-6);
    }
  });
});

describe('TimelineLayout: eje ordinal (X)', () => {
  it('hay un nodo por evento visible, en su rama, todos en la banda (y = z = 0)', () => {
    const layout = layoutOf(makeData());
    expect(layout.nodes.map((node) => node.eventId).sort()).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
    expect(nodeOf(layout, 'c-side').branch).toBe('side');
    for (const node of layout.nodes) expect([node.position.y, node.position.z]).toEqual([0, 0]);
    expect(layout.band).toEqual({ minY: 0, maxY: 0 });
  });

  it('paso constante entre nodos consecutivos, sea cual sea la distancia entre sus fechas', () => {
    const layout = layoutOf(makeLifeLinesData());
    const xs = layout.nodes.map((node) => node.position.x);
    xs.forEach((x, i) => expect(x).toBeCloseTo(i * STEP, 6));
    expect(layout.nodeStep).toBe(STEP);
    expect(layoutOf(makeLifeLinesData(), { nodeStep: 2 }).nodes.map((node) => node.position.x)).toEqual(xs.map((x) => (x / STEP) * 2));
  });

  it('orden cronológico; misma fecha: importancia, después la central, después el id', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'z-late', date: { start: '2020' } }),
        makeEvent({ id: 'b-side', date: { start: '2015' }, branch: 'side', importance: 2 }),
        makeEvent({ id: 'a-side', date: { start: '2015' }, branch: 'side', importance: 2 }),
        makeEvent({ id: 'c-main', date: { start: '2015' }, importance: 2 }),
        makeEvent({ id: 'd-major', date: { start: '2015' }, branch: 'side', importance: 3 }),
        makeEvent({ id: 'early', date: { start: '2010' } }),
      ]),
    );
    expect(layout.nodes.map((node) => node.eventId)).toEqual(['early', 'd-major', 'c-main', 'a-side', 'b-side', 'z-late']);
    expect(layout.nodes.map((node) => node.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('con visibles: solo esos nodos, recolocados con el mismo paso', () => {
    const timeline = timelineOf(makeLifeLinesData());
    const visible = new Set(['birth', 'show', 'job']);
    const layout = new TimelineLayout().compute(timeline, visible);
    expect(layout.nodes.map((node) => [node.eventId, node.position.x])).toEqual([
      ['birth', 0],
      ['show', STEP],
      ['job', 2 * STEP],
    ]);
    // Las líneas sin nodos visibles desaparecen; la central se mantiene.
    expect(layout.branches.map((branch) => branch.id).sort()).toEqual(['art', 'core']);
  });

  it('marcas de año solo donde cambia el año, en el primer nodo de ese año', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'a', date: { start: '2010-02' } }),
        makeEvent({ id: 'b', date: { start: '2010-09' } }),
        makeEvent({ id: 'c', date: { start: '2013' } }),
        makeEvent({ id: 'd', date: { start: '2013-04' } }),
        makeEvent({ id: 'e', date: { start: '2014' } }),
      ]),
    );
    expect(layout.years).toEqual([
      { year: 2010, x: 0 },
      { year: 2013, x: 2 * STEP },
      { year: 2014, x: 4 * STEP },
    ]);
  });

  it('«hoy» queda poco después del último nodo; los límites lo abarcan todo', () => {
    const layout = layoutOf(makeLifeLinesData());
    const last = layout.nodes[layout.nodes.length - 1].position.x;
    expect(layout.nowX).toBeCloseTo(last + O.nowSteps * STEP, 6);
    expect(layout.bounds.minX).toBeLessThan(0);
    expect(layout.bounds.maxX).toBeGreaterThan(layout.nowX);
    for (const point of layout.branches.flatMap((branch) => branch.points)) {
      expect(point.y).toBeGreaterThanOrEqual(layout.bounds.minY);
      expect(point.y).toBeLessThanOrEqual(layout.bounds.maxY);
    }
  });

  it('sin eventos devuelve solo la central y unos límites finitos', () => {
    const layout = layoutOf(dataWith([]));
    expect(layout.nodes).toEqual([]);
    expect(layout.branches).toHaveLength(1);
    expect(layout.branches[0].main).toBe(true);
    for (const value of Object.values(layout.bounds)) expect(Number.isFinite(value)).toBe(true);
  });

  it('las opciones se combinan con las de por defecto', () => {
    const layout = layoutOf(makeData(), { nodeStep: 5 });
    expect(layout.nodeStep).toBe(5);
    expect(nodeOf(layout, 'b-job').position.x).toBe(5);
  });
});

describe('TimelineLayout: líneas y carriles', () => {
  it('cada línea pasa exactamente por sus nodos', () => {
    for (const data of [makeData(), makeLifeLinesData(), sparseData()]) {
      const layout = layoutOf(data);
      for (const node of layout.nodes) {
        const branch = branchOf(layout, node.branch);
        expect(yAt(branch.points, node.position.x)).toBeCloseTo(0, 6);
      }
    }
  });

  it('entre dos nodos contiguos va recta por la banda', () => {
    const layout = layoutOf(dataWith([makeEvent({ id: 'a', date: { start: '2010' } }), makeEvent({ id: 'b', date: { start: '2011' } })]));
    const main = branchOf(layout, 'main');
    for (const point of main.points.filter((item) => item.x >= 0 && item.x <= STEP)) expect(point.y).toBe(0);
  });

  it('la línea central es una columna recta por la banda, por detrás de los símbolos', () => {
    for (const data of [makeData(), makeLifeLinesData(), sparseData()]) {
      const layout = layoutOf(data);
      const main = layout.branches.find((item) => item.main);
      if (!main) continue;
      for (const point of main.points) {
        expect(point.y).toBe(0);
        expect(point.z).toBeLessThan(0);
      }
    }
  });

  it('si hay nodos de otras líneas en medio, viaja por su carril (amplitud acotada) y no los tapa', () => {
    const layout = layoutOf(sparseData());
    const side = branchOf(layout, 'side');
    const lane = Math.abs(side.laneY);
    expect(lane).toBeGreaterThanOrEqual(O.laneMin * STEP - 1e-9);
    expect(lane).toBeLessThanOrEqual(O.laneMax * STEP + 1e-9);
    const s1 = nodeOf(layout, 's1').position.x;
    const s2 = nodeOf(layout, 's2').position.x;
    for (const node of layout.nodes.filter((item) => item.branch !== 'side' && item.position.x > s1 && item.position.x < s2)) {
      // Junto a cada nodo ajeno, la línea va por su carril: lejos del símbolo.
      expect(Math.abs(yAt(side.points, node.position.x))).toBeCloseTo(lane, 6);
    }
  });

  it('todas las líneas, en todos sus puntos, quedan dentro de ±laneMax × paso', () => {
    for (const data of [makeData(), makeLifeLinesData(), sparseData()]) {
      const layout = layoutOf(data);
      for (const point of layout.branches.flatMap((branch) => branch.points)) {
        expect(Math.abs(point.y)).toBeLessThanOrEqual(O.laneMax * STEP + 1e-9);
      }
    }
  });

  it('sin overshoot: |y| nunca supera su carril y es monótona en cada subida o bajada', () => {
    for (const data of [makeData(), makeLifeLinesData(), sparseData()]) {
      const layout = layoutOf(data);
      for (const branch of layout.branches) {
        const lane = Math.abs(branch.laneY);
        const ys = branch.points.map((point) => Math.abs(point.y));
        for (const y of ys) expect(y).toBeLessThanOrEqual(lane + 1e-9);
        // Entre un mínimo (0) y un máximo (carril) solo hay subida o bajada: sin rebotes.
        let direction = 0;
        let changes = 0;
        for (let i = 1; i < ys.length; i += 1) {
          const d = Math.sign(Math.round((ys[i] - ys[i - 1]) * 1000));
          if (d !== 0 && d !== direction) {
            if (direction !== 0) {
              changes += 1;
              // Solo se cambia de sentido en la banda o en el carril.
              expect(Math.min(ys[i - 1], Math.abs(ys[i - 1] - lane))).toBeLessThan(1e-6);
            }
            direction = d;
          }
        }
        expect(changes).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('las curvas de subida/bajada son cortas: llegan al carril en `ramp` × paso', () => {
    const layout = layoutOf(sparseData());
    const side = branchOf(layout, 'side');
    const s1 = nodeOf(layout, 's1').position.x;
    expect(Math.abs(yAt(side.points, s1 + O.ramp * STEP))).toBeCloseTo(Math.abs(side.laneY), 6);
    expect(Math.abs(yAt(side.points, s1 + (O.ramp * STEP) / 2))).toBeGreaterThan(0);
  });

  it('carriles distintos para líneas simultáneas; la central abajo, la primera lateral arriba', () => {
    const layout = layoutOf(makeLifeLinesData());
    const ys = layout.branches.map((branch) => branch.laneY);
    expect(new Set(ys).size).toBe(ys.length);
    expect(branchOf(layout, 'core').laneY).toBeLessThan(0);
    expect(new Set(layout.branches.map((branch) => branch.lane)).size).toBe(layout.branches.length);
    expect(layout.laneSpacing).toBeGreaterThan(0);
  });

  it('reutiliza un carril cuando la línea anterior ya ha terminado', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'm1', date: { start: '2010' } }),
        makeEvent({ id: 'a', date: { start: '2011' }, branch: 'one' }),
        makeEvent({ id: 'm2', date: { start: '2012' } }),
        makeEvent({ id: 'm3', date: { start: '2013' } }),
        makeEvent({ id: 'm4', date: { start: '2014' } }),
        makeEvent({ id: 'b', date: { start: '2015' }, branch: 'two' }),
      ]),
    );
    expect(branchOf(layout, 'one').lane).toBe(branchOf(layout, 'two').lane);
  });

  it('la línea nace en su nodo de origen visible y, sin él, poco antes de su primer nodo', () => {
    const layout = layoutOf(sparseData());
    const side = branchOf(layout, 'side');
    expect(side.originEventId).toBe('m2000');
    expect(side.points[0]).toEqual(nodeOf(layout, 'm2000').position);
    const orphan = layoutOf(dataWith([makeEvent({ id: 'm', date: { start: '2010' } }), makeEvent({ id: 's', date: { start: '2012' }, branch: 'side' })]));
    expect(branchOf(orphan, 'side').originEventId).toBeNull();
    expect(branchOf(orphan, 'side').points[0].x).toBeLessThan(nodeOf(orphan, 's').position.x);
  });

  it('una cerrada termina poco después de su último nodo; una abierta llega más allá de hoy', () => {
    const layout = layoutOf(makeLifeLinesData());
    const teach = branchOf(layout, 'teach');
    const food = branchOf(layout, 'food');
    expect(teach.open).toBe(false);
    expect(teach.points[teach.points.length - 1].x).toBeCloseTo(nodeOf(layout, 'class').position.x + O.tailSteps * STEP, 3);
    expect(food.open).toBe(true);
    expect(food.points[food.points.length - 1].x).toBeGreaterThan(layout.nowX);
  });

  it('una línea que converge termina en el nodo de destino', () => {
    const layout = layoutOf(makeLifeLinesData());
    const art = branchOf(layout, 'art');
    expect(art.merge?.into).toBe('core');
    expect(art.merge?.position).toEqual(nodeOf(layout, 'master').position);
    expect(art.points[art.points.length - 1]).toEqual(nodeOf(layout, 'master').position);
  });

  it('el foco se calcula con la fecha de cada punto (interpolada entre nodos)', () => {
    const layout = layoutOf(makeLifeLinesData());
    const core = branchOf(layout, 'core');
    expect(core.focus).toHaveLength(core.points.length);
    expect(core.focus[core.focus.length - 1]).toBe(1);
    expect(Math.min(...core.focus)).toBeLessThan(1);
  });
});

describe('TimelineLayout: tramos de duración', () => {
  it('los eventos con duración llevan un tramo sobre su rama; los puntuales no', () => {
    const layout = layoutOf(makeData());
    expect(nodeOf(layout, 'a-school').span?.length).toBeGreaterThan(1);
    expect(nodeOf(layout, 'c-side').span).toBeUndefined();
  });

  it('el tramo de un evento en curso llega hasta hoy', () => {
    const layout = layoutOf(makeData());
    const span = nodeOf(layout, 'b-job').span ?? [];
    expect(span[span.length - 1].x).toBeCloseTo(layout.nowX, 3);
  });
});

describe('TimelineLayout: capítulos', () => {
  it('cada capítulo abarca sus nodos con medio paso de margen; sin nodos visibles, no aparece', () => {
    const data = makeLifeLinesData((d) => {
      d.arcs = [
        { id: 'early', title: 'Primero', start: '2000', end: '2012' },
        { id: 'late', title: 'Después', start: '2013', end: 'present' },
      ];
    });
    const layout = layoutOf(data);
    const early = layout.arcs.find((arc) => arc.id === 'early');
    expect(early?.startX).toBe(-STEP / 2);
    expect(layout.arcs[layout.arcs.length - 1].endX).toBeGreaterThanOrEqual(layout.nowX);
    const timeline = timelineOf(data);
    const onlyLate = new TimelineLayout().compute(timeline, new Set(['show', 'job']));
    expect(onlyLate.arcs.map((arc) => arc.id)).toEqual(['late']);
  });
});

describe('TimelineLayout: enlaces causales (ledTo)', () => {
  const events = (): LifeData['events'] => [
    makeEvent({ id: 'tfg', date: { start: '2017' }, ledTo: ['culinary', 'coop'] }),
    makeEvent({ id: 'culinary', date: { start: '2018' }, branch: 'side', branchFrom: 'tfg' }),
    makeEvent({ id: 'mid', date: { start: '2019' } }),
    makeEvent({ id: 'coop', date: { start: '2020' } }),
  ];

  it('un arco por enlace, por encima de la banda, del nodo origen al destino', () => {
    const layout = layoutOf(dataWith(events()));
    expect(layout.links.map((link) => [link.from, link.to, link.fromBranch, link.toBranch])).toEqual([
      ['tfg', 'culinary', 'main', 'side'],
      ['tfg', 'coop', 'main', 'main'],
    ]);
    for (const link of layout.links) {
      const points = link.points;
      expect(points[0]).toEqual(nodeOf(layout, link.from).position);
      expect(points[points.length - 1]).toEqual(nodeOf(layout, link.to).position);
      for (const point of points) expect(point.y).toBeGreaterThanOrEqual(0);
      const height = Math.max(...points.map((point) => point.y));
      expect(height).toBeGreaterThanOrEqual(O.linkMinHeight - 1e-9);
      expect(height).toBeLessThanOrEqual(O.linkMaxHeight + 1e-9);
    }
    // Cuanto más lejos, más alto.
    const [near, far] = layout.links;
    expect(Math.max(...far.points.map((p) => p.y))).toBeGreaterThan(Math.max(...near.points.map((p) => p.y)));
  });

  it('sin ledTo no hay hebras; los destinos ocultos o filtrados se ignoran', () => {
    expect(layoutOf(makeData()).links).toEqual([]);
    const hidden = events().map((event) => (event.id === 'coop' ? { ...event, visibility: 'private' as const } : event));
    expect(layoutOf(dataWith(hidden)).links.map((link) => link.to)).toEqual(['culinary']);
    const filtered = new TimelineLayout().compute(timelineOf(dataWith(events())), new Set(['tfg', 'coop']));
    expect(filtered.links.map((link) => link.to)).toEqual(['coop']);
  });
});
