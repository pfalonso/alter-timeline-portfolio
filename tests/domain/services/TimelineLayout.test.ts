import { describe, expect, it } from 'vitest';
import type { LifeData } from '../../../src/domain/model';
import {
  DEFAULT_LAYOUT_OPTIONS,
  TimelineFactory,
  TimelineLayout,
  type LayoutOptions,
  type TimelineLayoutResult,
} from '../../../src/domain/services';
import { makeData, makeEvent, NOW } from '../../helpers/fixtures';

const O = DEFAULT_LAYOUT_OPTIONS;

function layoutOf(data: LifeData, options: Partial<LayoutOptions> = {}, includePrivate = false): TimelineLayoutResult {
  const timeline = new TimelineFactory().create(data, { now: NOW, includePrivate });
  return new TimelineLayout(options).compute(timeline);
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
  });

  it('las coordenadas están redondeadas a milésimas (sin ruido de coma flotante)', () => {
    const layout = layoutOf(makeData());
    const points = [...layout.nodes.map((node) => node.position), ...layout.branches.flatMap((branch) => branch.points)];
    for (const point of points) {
      for (const value of [point.x, point.y, point.z]) expect(Math.abs(value * 1000 - Math.round(value * 1000))).toBeLessThan(1e-6);
    }
  });
});

describe('TimelineLayout: eje temporal (X)', () => {
  it('hay un nodo por evento, en su rama', () => {
    const layout = layoutOf(makeData());
    expect(layout.nodes.map((node) => [node.eventId, node.branch])).toEqual([
      ['a-school', 'main'],
      ['b-job', 'main'],
      ['c-side', 'side'],
      ['e-side-two', 'side'],
    ]);
  });

  it('X = (año decimal − año de origen) × unidades por año', () => {
    const layout = layoutOf(makeData());
    expect(nodeOf(layout, 'a-school').position.x).toBe(0);
    expect(nodeOf(layout, 'b-job').position.x).toBeCloseTo((5 + 59 / 365) * O.unitsPerYear, 2);
    expect(layout.nowX).toBe(10 * O.unitsPerYear);
  });

  it('unitsPerYear escala el eje', () => {
    const layout = layoutOf(makeData(), { unitsPerYear: 10 });
    expect(nodeOf(layout, 'b-job').position.x).toBeCloseTo((5 + 59 / 365) * 10, 2);
    expect(layout.nowX).toBe(100);
  });

  it('separa los nodos de una misma rama que caerían demasiado juntos', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'a', date: { start: '2012-01-01' } }),
        makeEvent({ id: 'b', date: { start: '2012-01-02' } }),
        makeEvent({ id: 'c', date: { start: '2012-01-03' } }),
      ]),
    );
    const xs = ['a', 'b', 'c'].map((id) => nodeOf(layout, id).position.x);
    expect(xs[1] - xs[0]).toBeCloseTo(O.minNodeGap, 3);
    expect(xs[2] - xs[1]).toBeCloseTo(O.minNodeGap, 3);
  });

  it('nodos de ramas distintas en la misma fecha comparten X', () => {
    const layout = layoutOf(
      dataWith([makeEvent({ id: 'a', date: { start: '2012' } }), makeEvent({ id: 'b', date: { start: '2012' }, branch: 'otra' })]),
    );
    expect(nodeOf(layout, 'b').position.x).toBe(nodeOf(layout, 'a').position.x);
  });

  it('marcas de año: enteras, alineadas con el eje y nunca en el futuro', () => {
    const layout = layoutOf(makeData());
    expect(layout.years.map((mark) => mark.year)).toEqual([2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020]);
    for (const mark of layout.years) expect(mark.x).toBe((mark.year - 2010) * O.unitsPerYear);
    const midYear = new TimelineLayout().compute(
      new TimelineFactory().create(makeData(), { now: new Date(Date.UTC(2020, 6, 1)) }),
    );
    expect(midYear.years[midYear.years.length - 1].year).toBe(2020);
  });
});

describe('TimelineLayout: tronco', () => {
  it('el tronco va por el carril 0, sin origen, abierto, y solo ondula levemente', () => {
    const layout = layoutOf(makeData());
    const main = branchOf(layout, 'main');
    expect(main).toMatchObject({ lane: 0, originEventId: null, open: true });
    for (const point of main.points) {
      expect(Math.abs(point.y)).toBeLessThanOrEqual(O.waveAmplitude + 1e-9);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(O.waveAmplitude * 0.8 + 1e-9);
    }
  });

  it('empieza con margen antes del primer evento y sigue un poco más allá de hoy', () => {
    const layout = layoutOf(makeData());
    const main = branchOf(layout, 'main');
    const pad = O.padYears * O.unitsPerYear;
    expect(main.points[0].x).toBeCloseTo(-pad, 3);
    expect(main.points[main.points.length - 1].x).toBeCloseTo(layout.nowX + pad / 2, 3);
  });

  it('la polilínea avanza en X con el paso de muestreo configurado', () => {
    const main = branchOf(layoutOf(makeData()), 'main');
    for (let i = 1; i < main.points.length; i += 1) {
      const step = main.points[i].x - main.points[i - 1].x;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(O.sampleStep + 1e-3);
    }
  });

  it('los nodos del tronco están sobre su curva', () => {
    const layout = layoutOf(makeData());
    for (const id of ['a-school', 'b-job']) expect(Math.abs(nodeOf(layout, id).position.y)).toBeLessThanOrEqual(O.waveAmplitude);
  });

  it('sin eventos devuelve solo el tronco y unos límites finitos', () => {
    const layout = layoutOf(dataWith([]));
    expect(layout.nodes).toEqual([]);
    expect(layout.branches.map((branch) => branch.id)).toEqual(['main']);
    expect(Object.values(layout.bounds).every(Number.isFinite)).toBe(true);
    expect(layout.nowX).toBe(5);
  });
});

describe('TimelineLayout: ramas y branchFrom', () => {
  it('la rama nace EXACTAMENTE en la posición del evento branchFrom', () => {
    const layout = layoutOf(makeData());
    const side = branchOf(layout, 'side');
    expect(side.originEventId).toBe('b-job');
    expect(side.points[0]).toEqual(nodeOf(layout, 'b-job').position);
  });

  it('sus nodos viven en la banda y, entre ellos, la línea sale hasta su carril (Y y Z)', () => {
    const layout = layoutOf(makeData());
    const side = branchOf(layout, 'side');
    expect(side.lane).toBe(1);
    const first = nodeOf(layout, 'c-side').position;
    const second = nodeOf(layout, 'e-side-two').position;
    for (const node of [first, second]) {
      expect(Math.abs(node.y)).toBeLessThanOrEqual(O.bandHalfHeight + O.stackGap);
      expect(node.z).toBeCloseTo(0, 6);
    }
    // Entre los dos nodos la línea se curva fuera de la banda, hacia su carril y hacia el fondo.
    const between = side.points.filter((point) => point.x > first.x && point.x < second.x);
    expect(Math.max(...between.map((point) => point.y))).toBeGreaterThan(O.laneSpacing - O.waveAmplitude - 1e-9);
    expect(Math.min(...between.map((point) => point.z))).toBeLessThan(-O.laneDepth + O.waveAmplitude);
  });

  it('el nodo de una rama está sobre la polilínea de su rama', () => {
    const layout = layoutOf(makeData());
    const side = branchOf(layout, 'side');
    const node = nodeOf(layout, 'c-side').position;
    const after = side.points.findIndex((point) => point.x >= node.x);
    const [a, b] = [side.points[after - 1], side.points[after]];
    expect(node.y).toBeGreaterThanOrEqual(Math.min(a.y, b.y) - 0.05);
    expect(node.y).toBeLessThanOrEqual(Math.max(a.y, b.y) + 0.05);
  });

  it('una rama cerrada se prolonga tailYears tras su último fin; una abierta llega hasta más allá de hoy', () => {
    const closed = layoutOf(makeData());
    const side = branchOf(closed, 'side');
    expect(side.open).toBe(false);
    const lastEnd = (2018 + 151 / 365 - 2010) * O.unitsPerYear; // fin "2018-06" → inicio de junio
    expect(side.points[side.points.length - 1].x).toBeCloseTo(lastEnd + O.tailYears * O.unitsPerYear, 2);

    const data = makeData();
    data.events[4].date = { start: '2018-01-15', end: 'present' };
    const open = layoutOf(data);
    expect(branchOf(open, 'side').open).toBe(true);
    const mainEnd = branchOf(open, 'main').points.at(-1)?.x;
    expect(branchOf(open, 'side').points.at(-1)?.x).toBe(mainEnd);
  });

  it('si el evento de origen está oculto (privado), la rama nace del tronco sin origen', () => {
    const data = makeData();
    data.events[2].branchFrom = 'd-secret';
    data.events[2].date = { start: '2018' };
    data.events[4].date = { start: '2019' };
    const hidden = layoutOf(data);
    const side = branchOf(hidden, 'side');
    expect(side.originEventId).toBeNull();
    expect(side.points[0]).toMatchObject({ y: 0, z: 0 });
    expect(side.points[0].x).toBeCloseTo((8 - O.blendYears) * O.unitsPerYear, 3);

    const shown = layoutOf(data, {}, true);
    expect(branchOf(shown, 'side').originEventId).toBe('d-secret');
    expect(branchOf(shown, 'side').points[0]).toEqual(nodeOf(shown, 'd-secret').position);
  });

  it('si la rama empieza antes que su origen, se separa de la línea madre en su propia X', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'm-a', date: { start: '2010' } }),
        makeEvent({ id: 'm-b', date: { start: '2016' } }),
        makeEvent({ id: 'temprano', date: { start: '2013' }, branch: 'precoz', branchFrom: 'm-b' }),
      ]),
    );
    const early = branchOf(layout, 'precoz');
    const trunk = branchOf(layout, 'main');
    const start = early.points[0];
    expect(early.originEventId).toBe('m-b');
    expect(start.x).toBeLessThan(nodeOf(layout, 'm-b').position.x);
    expect(start.x).toBeCloseTo((3 - 0.5) * O.unitsPerYear, 3);
    // El primer punto cae sobre el tronco a esa misma X (no a la altura del nodo de 2016).
    const onTrunk = trunk.points.reduce((best, point) => (Math.abs(point.x - start.x) < Math.abs(best.x - start.x) ? point : best));
    expect(Math.abs(start.y - onTrunk.y)).toBeLessThan(0.2);
    expect(Math.abs(start.z - onTrunk.z)).toBeLessThan(0.2);
  });

  it('una rama sin branchFrom nace del tronco un poco antes de su primer evento', () => {
    const layout = layoutOf(dataWith([makeEvent({ id: 'm', date: { start: '2010' } }), makeEvent({ id: 's', date: { start: '2014' }, branch: 'suelta' })]));
    const loose = branchOf(layout, 'suelta');
    expect(loose.originEventId).toBeNull();
    expect(loose.points[0].x).toBeCloseTo((4 - O.blendYears) * O.unitsPerYear, 3);
  });

  it('ramas anidadas: una rama que nace de otra rama arranca sobre el nodo de la rama madre', () => {
    const data = makeData();
    data.events.push(makeEvent({ id: 'nested', branch: 'deep', branchFrom: 'e-side-two', date: { start: '2019-06' }, categories: ['play'] }));
    const layout = layoutOf(data);
    const deep = branchOf(layout, 'deep');
    expect(deep.originEventId).toBe('e-side-two');
    expect(deep.points[0]).toEqual(nodeOf(layout, 'e-side-two').position);
    expect(deep.lane).not.toBe(branchOf(layout, 'side').lane);
  });

  it('el resultado no depende de que la rama hija se declare antes que la madre', () => {
    const data = makeData();
    // "aaa" se ordena antes que "side": su origen (en side) se resuelve de forma recursiva.
    data.events.push(makeEvent({ id: 'nested', branch: 'aaa', branchFrom: 'c-side', date: { start: '2017-03' }, categories: ['play'] }));
    const layout = layoutOf(data);
    expect(branchOf(layout, 'aaa').points[0]).toEqual(nodeOf(layout, 'c-side').position);
  });
});

describe('TimelineLayout: carriles', () => {
  const branchEvent = (id: string, start: string, branch: string): LifeData['events'][number] =>
    makeEvent({ id, date: { start }, branch });

  it('ramas simultáneas alternan carriles +1, −1, +2, −2', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'm', date: { start: '2010' } }),
        branchEvent('a', '2012-01', 'ba'),
        branchEvent('b', '2012-02', 'bb'),
        branchEvent('c', '2012-03', 'bc'),
        branchEvent('d', '2012-04', 'bd'),
      ]),
    );
    expect(['ba', 'bb', 'bc', 'bd'].map((id) => branchOf(layout, id).lane)).toEqual([1, -1, 2, -2]);
    // En la banda, cada nodo lleva un ligero desfase hacia el lado de su carril.
    expect(nodeOf(layout, 'a').position.y).toBeGreaterThan(0);
    expect(nodeOf(layout, 'b').position.y).toBeLessThan(0);
    expect(Math.abs(nodeOf(layout, 'c').position.y)).toBeGreaterThan(Math.abs(nodeOf(layout, 'a').position.y));
  });

  it('reutiliza un carril cuando la rama anterior ya ha terminado', () => {
    const layout = layoutOf(
      dataWith([makeEvent({ id: 'm', date: { start: '2010' } }), branchEvent('a', '2011', 'ba'), branchEvent('b', '2018', 'bb')]),
    );
    expect(branchOf(layout, 'ba').lane).toBe(1);
    expect(branchOf(layout, 'bb').lane).toBe(1);
  });

  it('una rama abierta bloquea su carril para las posteriores', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'm', date: { start: '2010' } }),
        makeEvent({ id: 'a', date: { start: '2011', end: 'present' }, branch: 'ba' }),
        branchEvent('b', '2018', 'bb'),
      ]),
    );
    expect(branchOf(layout, 'ba').lane).toBe(1);
    expect(branchOf(layout, 'bb').lane).toBe(-1);
  });
});

describe('TimelineLayout: carriles compactos', () => {
  const branchEvent = (id: string, start: string, branch: string, extra: Partial<LifeData['events'][number]> = {}): LifeData['events'][number] =>
    makeEvent({ id, date: { start }, branch, ...extra });
  /** n ramas abiertas que nacen del tronco casi a la vez (todas conviven hasta hoy). */
  const concurrent = (n: number): LifeData['events'] => [
    makeEvent({ id: 'm', date: { start: '2005' } }),
    ...Array.from({ length: n }, (_, i) =>
      makeEvent({ id: `e${i}`, date: { start: `2010-01-${String(i + 1).padStart(2, '0')}`, end: 'present' }, branch: `b${String(i).padStart(2, '0')}` }),
    ),
  ];

  it('una rama nace en el carril libre más cercano al de su madre, sin cruzar el tronco', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'm', date: { start: '2010' } }),
        makeEvent({ id: 'up', date: { start: '2011', end: 'present' }, branch: 'arriba' }),
        makeEvent({ id: 'down', date: { start: '2011-06', end: 'present' }, branch: 'abajo' }),
        branchEvent('hija', '2013', 'hija', { branchFrom: 'down' }),
      ]),
    );
    expect(branchOf(layout, 'arriba').lane).toBe(1);
    expect(branchOf(layout, 'abajo').lane).toBe(-1);
    // Antes habría ido a +2 (alternando); ahora queda junto a su madre, en el mismo lado.
    expect(branchOf(layout, 'hija').lane).toBe(-2);
  });

  it('a igual distancia de la madre, prefiere el carril más cercano al tronco', () => {
    const layout = layoutOf(
      dataWith([
        makeEvent({ id: 'm', date: { start: '2010' } }),
        makeEvent({ id: 'a', date: { start: '2011-01', end: 'present' }, branch: 'ba' }),
        makeEvent({ id: 'b', date: { start: '2011-02', end: '2012' }, branch: 'bb' }),
        makeEvent({ id: 'c', date: { start: '2011-03', end: 'present' }, branch: 'bc' }),
        makeEvent({ id: 'd', date: { start: '2011-04', end: 'present' }, branch: 'bd' }),
        branchEvent('d2', '2016', 'bd'),
        branchEvent('e', '2017', 'be', { branchFrom: 'd2' }),
      ]),
    );
    expect(['ba', 'bb', 'bc', 'bd'].map((id) => branchOf(layout, id).lane)).toEqual([1, -1, 2, -2]);
    // `bb` ya terminó: −1 y −3 están libres y a distancia 1 de −2; gana −1, el más cercano al tronco.
    expect(branchOf(layout, 'be').lane).toBe(-1);
  });

  it('el número de carriles depende de las ramas simultáneas, no del total', () => {
    // 10 ramas en secuencia (cada una termina antes de que nazca la siguiente): un único carril.
    const sequential = layoutOf(
      dataWith([
        makeEvent({ id: 'm', date: { start: '2000' } }),
        ...Array.from({ length: 10 }, (_, i) => branchEvent(`s${i}`, String(2001 + i * 3), `s${String(i).padStart(2, '0')}`)),
      ]),
    );
    const lanes = new Set(sequential.branches.filter((branch) => branch.id !== 'main').map((branch) => branch.lane));
    expect(lanes.size).toBe(1);

    for (const n of [2, 5, 8, 10]) {
      const layout = layoutOf(dataWith(concurrent(n)));
      const side = layout.branches.filter((branch) => branch.id !== 'main').map((branch) => branch.lane);
      expect(new Set(side).size).toBe(n);
      expect(Math.max(...side.map(Math.abs))).toBe(Math.ceil(n / 2));
    }
  });

  it('con muchos carriles la separación se comprime, acotada entre el mínimo y el máximo', () => {
    expect(layoutOf(dataWith(concurrent(2))).laneSpacing).toBe(O.laneSpacing);
    const eight = layoutOf(dataWith(concurrent(8)));
    expect(eight.laneSpacing).toBeCloseTo(Math.max(O.minLaneSpacing, O.maxLaneSpread / 4), 3);
    expect(eight.laneSpacing).toBeLessThan(O.laneSpacing);
    // Cota: ningún punto se aleja del tronco más que el carril extremo + la ondulación.
    const reach = 4 * eight.laneSpacing + O.waveAmplitude + 1e-6;
    for (const point of eight.branches.flatMap((branch) => branch.points)) expect(Math.abs(point.y)).toBeLessThanOrEqual(reach);
    // Con 20 ramas la separación no baja del mínimo.
    expect(layoutOf(dataWith(concurrent(20))).laneSpacing).toBe(O.minLaneSpacing);
  });

  it('la profundidad (Z) se comprime en la misma proporción que la separación', () => {
    const flat = { waveAmplitude: 0 };
    const two = layoutOf(dataWith(concurrent(2)), flat);
    const eight = layoutOf(dataWith(concurrent(8)), flat);
    // Z del carril (lejos de los nodos): la mínima de la rama del evento e0.
    const zOf = (layout: TimelineLayoutResult, id: string): number =>
      Math.min(...branchOf(layout, nodeOf(layout, id).branch).points.map((point) => point.z));
    expect(zOf(two, 'e0')).toBeCloseTo(-O.laneDepth, 3);
    expect(zOf(eight, 'e0')).toBeCloseTo(-O.laneDepth * (eight.laneSpacing / O.laneSpacing), 3);
  });

  it('el reparto es determinista aunque cambie el orden de los eventos', () => {
    const events = concurrent(9);
    expect(layoutOf(dataWith([...events].reverse()))).toEqual(layoutOf(dataWith(events)));
  });
});

describe('TimelineLayout: tramos de duración y límites', () => {
  it('los eventos con duración llevan un tramo (span) sobre su rama; los puntuales no', () => {
    const layout = layoutOf(makeData());
    expect(nodeOf(layout, 'c-side').span).toBeUndefined();
    const school = nodeOf(layout, 'a-school');
    expect(school.span?.[0]).toEqual(school.position);
    expect(school.span?.at(-1)?.x).toBe(4 * O.unitsPerYear);
  });

  it('el tramo de un evento en curso llega hasta hoy', () => {
    const layout = layoutOf(makeData());
    expect(nodeOf(layout, 'b-job').span?.at(-1)?.x).toBe(layout.nowX);
  });

  it('un periodo más corto que el paso de muestreo no genera tramo', () => {
    const layout = layoutOf(dataWith([makeEvent({ id: 'corto', date: { start: '2012-03-01', end: '2012-03-10' } })]));
    expect(nodeOf(layout, 'corto').span).toBeUndefined();
  });

  it('los límites abarcan todos los puntos de todas las ramas y todos los nodos', () => {
    const layout = layoutOf(makeData());
    const { minX, maxX, minY, maxY } = layout.bounds;
    const points = layout.branches.flatMap((branch) => branch.points);
    expect(minX).toBe(Math.min(...points.map((point) => point.x)));
    expect(maxX).toBe(Math.max(...points.map((point) => point.x)));
    expect(minY).toBe(Math.min(...points.map((point) => point.y)));
    expect(maxY).toBe(Math.max(...points.map((point) => point.y)));
    for (const node of layout.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(minX);
      expect(node.position.x).toBeLessThanOrEqual(maxX);
      expect(node.position.y).toBeGreaterThanOrEqual(minY);
      expect(node.position.y).toBeLessThanOrEqual(maxY);
    }
  });

  it('las opciones se combinan con las de por defecto', () => {
    const flat = layoutOf(makeData(), { waveAmplitude: 0, laneSpacing: 10, maxLaneSpread: 10 });
    for (const point of branchOf(flat, 'main').points) expect(Math.abs(point.y) + Math.abs(point.z)).toBe(0);
    expect(Math.max(...branchOf(flat, 'side').points.map((point) => point.y))).toBeCloseTo(10, 1);
    expect(layoutOf(makeData(), { bandLaneStep: 0.9 }).nodes.find((node) => node.eventId === 'e-side-two')?.position.y).toBe(0.9);
  });
});

describe('TimelineLayout: banda narrativa', () => {
  const sameDay = (): LifeData['events'] => [
    makeEvent({ id: 'm1', date: { start: '2010' } }),
    makeEvent({ id: 'm2', date: { start: '2014-05' } }),
    makeEvent({ id: 'u', date: { start: '2014-05' }, branch: 'up', branchFrom: 'm1' }),
    makeEvent({ id: 'd', date: { start: '2014-05' }, branch: 'down', branchFrom: 'm1' }),
    makeEvent({ id: 'u2', date: { start: '2018' }, branch: 'up' }),
  ];

  it('todos los nodos quedan en una banda central estrecha, aunque las líneas se alejen', () => {
    const layout = layoutOf(dataWith(sameDay()));
    for (const node of layout.nodes) expect(Math.abs(node.position.y)).toBeLessThanOrEqual(O.bandHalfHeight + 2 * O.stackGap);
    expect(layout.band.maxY - layout.band.minY).toBeLessThan(layout.bounds.maxY - layout.bounds.minY);
  });

  it('nodos de la misma fecha se apilan con la separación mínima', () => {
    const layout = layoutOf(dataWith(sameDay()));
    const ys = ['m2', 'u', 'd'].map((id) => nodeOf(layout, id).position.y).sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(O.stackGap - 1e-9);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(O.stackGap - 1e-9);
  });

  it('cada línea pasa exactamente por sus nodos', () => {
    const layout = layoutOf(dataWith(sameDay()));
    for (const node of layout.nodes) {
      const branch = branchOf(layout, node.branch);
      const closest = branch.points.reduce((best, point) => (Math.abs(point.x - node.position.x) < Math.abs(best.x - node.position.x) ? point : best));
      expect(Math.abs(closest.y - node.position.y)).toBeLessThan(0.15);
    }
  });

  it('es determinista', () => {
    expect(layoutOf(dataWith(sameDay()))).toEqual(layoutOf(dataWith([...sameDay()].reverse())));
  });
});

describe('TimelineLayout: enlaces causales (ledTo)', () => {
  const events = (): LifeData['events'] => [
    makeEvent({ id: 'tfg', date: { start: '2017' }, ledTo: ['culinary', 'coop'] }),
    makeEvent({ id: 'culinary', date: { start: '2018' }, branch: 'side', branchFrom: 'tfg' }),
    makeEvent({ id: 'coop', date: { start: '2020' } }),
  ];

  it('una hebra por enlace, del nodo origen al destino, con las líneas de ambos', () => {
    const layout = layoutOf(dataWith(events()));
    expect(layout.links.map((link) => [link.from, link.to, link.fromBranch, link.toBranch])).toEqual([
      ['tfg', 'culinary', 'main', 'side'],
      ['tfg', 'coop', 'main', 'main'],
    ]);
    for (const link of layout.links) {
      const points = link.points;
      expect(points[0]).toEqual(nodeOf(layout, link.from).position);
      expect(points[points.length - 1]).toEqual(nodeOf(layout, link.to).position);
      // Arquea un poco hacia delante para leerse por encima de las líneas.
      expect(Math.max(...points.map((point) => point.z))).toBeGreaterThan(0.5);
    }
  });

  it('sin ledTo no hay hebras; los destinos ocultos se ignoran', () => {
    expect(layoutOf(makeData()).links).toEqual([]);
    const hidden = events().map((event) => (event.id === 'coop' ? { ...event, visibility: 'private' as const } : event));
    expect(layoutOf(dataWith(hidden)).links.map((link) => link.to)).toEqual(['culinary']);
  });
});
