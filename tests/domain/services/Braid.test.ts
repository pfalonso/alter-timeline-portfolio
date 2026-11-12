import { describe, expect, it } from 'vitest';
import type { LifeData } from '../../../src/domain/model';
import {
  braidBoundaries,
  braidChangesOf,
  braidMembersAt,
  isFocusedAt,
  isInBraidAt,
  LifeDataValidator,
  TimelineFactory,
  TimelineLayout,
  type TimelineLayoutResult,
} from '../../../src/domain/services';
import { makeData, makeEvent, makeLifeLinesData, NOW } from '../../helpers/fixtures';

const build = (data: LifeData) => new TimelineFactory().create(data, { now: NOW });
const layoutOf = (data: LifeData): TimelineLayoutResult => new TimelineLayout().compute(build(data));
const branchOf = (layout: TimelineLayoutResult, id: string) => {
  const branch = layout.branches.find((item) => item.id === id);
  if (!branch) throw new Error(`no hay línea ${id}`);
  return branch;
};
const nodeOf = (layout: TimelineLayoutResult, id: string) => {
  const node = layout.nodes.find((item) => item.eventId === id);
  if (!node) throw new Error(`no hay nodo ${id}`);
  return node;
};

/**
 * Tres líneas que se relevan en el foco: `tech` (central) hasta 2010 y desde 2020; `food` de 2010 a
 * 2015; `art` de 2014 a 2018 y se fusiona en `tech` en 2019 (sin eventos entre medias). `life` nunca
 * está en foco. En 2019, sin nadie en foco, la trenza vuelve a ser `tech`.
 */
function relay(mutate: (data: LifeData) => void = () => undefined): LifeData {
  const data: LifeData = {
    schemaVersion: 1,
    meta: { owner: 'Ada', title: 'Relevo', locale: 'es', mainBranch: 'tech' },
    categories: [{ id: 'work', label: 'Trabajo', color: '#FFB454' }],
    events: [
      makeEvent({ id: 'birth', date: { start: '2000' }, branch: 'tech' }),
      makeEvent({ id: 't1', date: { start: '2005' }, branch: 'tech' }),
      makeEvent({ id: 'f1', date: { start: '2009' }, branch: 'food' }),
      makeEvent({ id: 'f2', date: { start: '2011' }, branch: 'food' }),
      makeEvent({ id: 't2', date: { start: '2012' }, branch: 'tech' }),
      makeEvent({ id: 'l1', date: { start: '2013' }, branch: 'life' }),
      makeEvent({ id: 'a1', date: { start: '2016' }, branch: 'art' }),
      makeEvent({ id: 'f3', date: { start: '2017' }, branch: 'food' }),
      makeEvent({ id: 'merge', date: { start: '2019' }, branch: 'tech' }),
      makeEvent({ id: 't3', date: { start: '2021' }, branch: 'tech' }),
      makeEvent({ id: 'l2', date: { start: '2022' }, branch: 'life' }),
    ],
    branches: [
      { id: 'tech', label: 'Tecnología', focus: [{ start: '2000', end: '2009' }, { start: '2020', end: 'present' }] },
      { id: 'food', label: 'Cocina', origin: 'birth', until: 'present', focus: [{ start: '2010', end: '2015' }] },
      { id: 'art', label: 'Arte', origin: 'birth', mergeInto: { branch: 'tech', event: 'merge' }, focus: [{ start: '2014', end: '2018' }] },
      { id: 'life', label: 'Vida', origin: 'birth', until: 'present' },
    ],
  };
  mutate(data);
  return data;
}

describe('Braid: pertenencia a la trenza por fecha', () => {
  it('isFocusedAt: dentro de algún periodo (fin incluido hasta el final de su año/mes)', () => {
    const tech = build(relay()).getLine('tech');
    expect(isFocusedAt(tech, 2004)).toBe(true);
    expect(isFocusedAt(tech, 2009.9)).toBe(true);
    expect(isFocusedAt(tech, 2010.01)).toBe(false);
    expect(isFocusedAt(tech, 2030)).toBe(true);
    expect(isFocusedAt(undefined, 2004)).toBe(false);
  });

  it('las líneas en foco forman la trenza; varias a la vez, en el orden de las líneas', () => {
    const timeline = build(relay());
    expect(braidMembersAt(timeline, 2005)).toEqual(['tech']);
    expect(braidMembersAt(timeline, 2012)).toEqual(['food']);
    expect(braidMembersAt(timeline, 2014.5)).toEqual(['food', 'art']);
    expect(braidMembersAt(timeline, 2024)).toEqual(['tech']);
    expect(isInBraidAt(timeline, 'life', 2013)).toBe(false);
  });

  it('si ninguna línea está en foco, la trenza es la central', () => {
    const timeline = build(relay((d) => (d.branches![2].focus = [{ start: '2017', end: '2018' }])));
    // 2016: nadie en foco.
    expect(braidMembersAt(timeline, 2016.5)).toEqual(['tech']);
    // Sin focos declarados en ningún sitio: siempre la central.
    const plain = build(makeData());
    expect(braidMembersAt(plain, 2012)).toEqual(['main']);
  });

  it('una línea que se fusiona sigue en la trenza desde su último foco hasta la fusión, y después no existe', () => {
    const timeline = build(relay());
    // El foco de art acaba en 2018, pero no tiene eventos hasta la fusión (2019): no sale.
    expect(isInBraidAt(timeline, 'art', 2018.6)).toBe(true);
    expect(isInBraidAt(timeline, 'art', 2019.5)).toBe(false);
    expect(braidChangesOf(timeline, 'art', 2000, 2019)).toEqual([{ year: 2014, kind: 'join' }]);
  });

  it('con eventos entre su último foco y la fusión, vuelve a su carril (y se une al fusionarse)', () => {
    const timeline = build(
      relay((d) => {
        d.branches![2].focus = [{ start: '2014', end: '2017-06' }];
        d.events.push(makeEvent({ id: 'a2', date: { start: '2018-03' }, branch: 'art' }));
      }),
    );
    expect(isInBraidAt(timeline, 'art', 2018.6)).toBe(false);
    expect(braidChangesOf(timeline, 'art', 2000, 2019).map((change) => change.kind)).toEqual(['join', 'split']);
  });

  it('bordes: inicios y finales de foco y fusiones, ordenados y sin repetir', () => {
    const years = braidBoundaries(build(relay()));
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(new Set(years).size).toBe(years.length);
    expect(years).toContain(2014);
    expect(years).toContain(2019);
  });

  it('cambios de la central: sale al pasar el foco a otra línea y vuelve cuando ya nadie lo tiene', () => {
    const timeline = build(relay());
    expect(braidChangesOf(timeline, 'tech', 2000, 2026).map((change) => change.kind)).toEqual(['split', 'join']);
    expect(braidChangesOf(timeline, 'life', 2000, 2026)).toEqual([]);
  });
});

describe('TimelineLayout: la trenza', () => {
  it('cada nodo, en la trenza (y = 0) o en el carril de su línea según el foco en su fecha', () => {
    const layout = layoutOf(relay());
    const expectations: Record<string, 'braid' | 'lane'> = {
      t1: 'braid',
      f1: 'lane',
      f2: 'braid',
      t2: 'lane',
      l1: 'lane',
      a1: 'braid',
      f3: 'lane',
      merge: 'braid',
      t3: 'braid',
      l2: 'lane',
    };
    for (const [id, where] of Object.entries(expectations)) {
      const node = nodeOf(layout, id);
      const lane = branchOf(layout, node.branch).laneY;
      expect(lane).not.toBe(0);
      expect(node.position.y, id).toBe(where === 'braid' ? 0 : lane);
    }
  });

  it('las uniones y separaciones son curvas monótonas entre 0 y el carril (sin overshoot)', () => {
    for (const data of [relay(), makeLifeLinesData()]) {
      const layout = layoutOf(data);
      for (const branch of layout.branches) {
        const lane = branch.laneY;
        // Las que nacen en otro carril pueden empezar fuera de su rango: se mira desde que llegan.
        const ys = branch.points.map((point) => point.y);
        const lo = Math.min(0, lane, ys[0]);
        const hi = Math.max(0, lane, ys[0]);
        for (const y of ys) {
          expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(y).toBeLessThanOrEqual(hi + 1e-9);
        }
        // Sin rebotes: solo se cambia de sentido en un valor de reposo (0, carril o el de partida).
        let direction = 0;
        for (let i = 1; i < ys.length; i += 1) {
          const d = Math.sign(Math.round((ys[i] - ys[i - 1]) * 1000));
          if (d !== 0 && d !== direction) {
            if (direction !== 0) {
              const at = ys[i - 1];
              expect(Math.min(Math.abs(at), Math.abs(at - lane), Math.abs(at - ys[0]))).toBeLessThan(1e-6);
            }
            direction = d;
          }
        }
      }
    }
  });

  it('las curvas de unión no invaden los nodos: la línea pasa exactamente por cada uno de los suyos', () => {
    const layout = layoutOf(relay());
    for (const node of layout.nodes) {
      const points = branchOf(layout, node.branch).points;
      const i = points.findIndex((point) => point.x >= node.position.x);
      const [a, b] = [points[Math.max(0, i - 1)], points[i]];
      const y = b.x === a.x ? b.y : a.y + ((b.y - a.y) * (node.position.x - a.x)) / (b.x - a.x);
      expect(y, node.eventId).toBeCloseTo(node.position.y, 9);
    }
  });

  it('genera uniones y separaciones en la trenza (y = 0) y la fusión al final de la línea', () => {
    const layout = layoutOf(relay());
    const of = (branch: string) => layout.junctions.filter((junction) => junction.branch === branch).map((junction) => junction.kind);
    expect(of('food')).toEqual(['birth', 'join', 'split']);
    expect(of('tech')).toEqual(['split', 'join']);
    expect(of('art')).toEqual(['birth', 'join', 'merge']);
    expect(of('life')).toEqual(['birth']);
    for (const junction of layout.junctions.filter((item) => item.kind === 'join' || item.kind === 'split')) expect(junction.position.y).toBe(0);
    const xs = layout.junctions.map((junction) => junction.position.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('una fusión no vuelve a salir: tras unirse a la trenza sigue en y = 0 hasta su final', () => {
    const layout = layoutOf(relay());
    const art = branchOf(layout, 'art');
    const join = layout.junctions.find((junction) => junction.branch === 'art' && junction.kind === 'join');
    const after = art.points.filter((point) => point.x >= (join?.position.x ?? 0));
    expect(after.length).toBeGreaterThan(2);
    for (const point of after) expect(point.y).toBe(0);
    expect(art.points[art.points.length - 1].x).toBe(nodeOf(layout, 'merge').position.x);
    // Su pertenencia a la trenza es plena desde la unión.
    expect(art.braid[art.braid.length - 1]).toBe(1);
  });

  it('la pertenencia a la trenza por punto va de 0 (carril) a 1 (centro)', () => {
    const layout = layoutOf(relay());
    for (const branch of layout.branches) {
      expect(branch.braid).toHaveLength(branch.points.length);
      branch.braid.forEach((w, i) => {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
        if (branch.points[i].y === 0) expect(w).toBe(1);
        if (branch.points[i].y === branch.laneY) expect(w).toBe(0);
      });
    }
    // Sin focos, la central no tiene carril: toda ella es trenza.
    const main = branchOf(layoutOf(makeData()), 'main');
    expect(main.braid.every((w) => w === 1)).toBe(true);
  });

  it('tramos de la trenza contiguos de un extremo a otro, con sus líneas', () => {
    const layout = layoutOf(relay());
    const spans = layout.braidSpans;
    expect(spans[0].startX).toBe(layout.bounds.minX);
    expect(spans[spans.length - 1].endX).toBe(layout.bounds.maxX);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i].startX).toBe(spans[i - 1].endX);
    const at = (id: string) => {
      const x = nodeOf(layout, id).position.x;
      return spans.find((span) => x >= span.startX && x <= span.endX)?.members;
    };
    expect(at('t1')).toEqual(['tech']);
    expect(at('f2')).toEqual(['food']);
    expect(at('t3')).toEqual(['tech']);
    expect(at('a1')).toContain('art');
  });

  it('es determinista', () => {
    expect(layoutOf(relay())).toEqual(layoutOf(relay()));
  });
});

describe('braidMembersAt: la central nace en un nodo y se pausa', () => {
  const data = (): LifeData =>
    relay((d) => {
      d.meta.mainBranch = 'tech';
      const tech = d.branches?.find((line) => line.id === 'tech');
      if (tech) Object.assign(tech, { origin: 'l1', focus: [], pauses: [{ from: 'merge', to: 't3' }] });
      for (const event of d.events) if (event.id === 'birth' || event.id === 't1' || event.id === 't2') event.branch = 'life';
      const life = d.branches?.find((line) => line.id === 'life');
      if (life) delete life.origin;
      for (const line of d.branches ?? []) if (line.id !== 'tech') line.origin = line.id === 'life' ? undefined : 'birth';
    });

  it('antes de nacer y durante su pausa, sin focos, la trenza es la línea del primer evento', () => {
    const timeline = new TimelineFactory().create(new LifeDataValidator().assertValid(data()), { now: new Date(Date.UTC(2024, 0, 1)) });
    expect(braidMembersAt(timeline, 2001)).toEqual(['life']);
    expect(braidMembersAt(timeline, 2013.5)).not.toContain('tech');
    expect(braidMembersAt(timeline, 2020)).toEqual(['life']);
    expect(braidMembersAt(timeline, 2021.5)).toEqual(['tech']);
  });

  it('el layout dibuja la central desde su origen y con el hueco de la pausa', () => {
    const timeline = new TimelineFactory().create(new LifeDataValidator().assertValid(data()), { now: new Date(Date.UTC(2024, 0, 1)) });
    const layout = new TimelineLayout().compute(timeline);
    const tech = layout.branches.find((branch) => branch.id === 'tech');
    const originX = layout.nodes.find((node) => node.eventId === 'l1')?.position.x ?? NaN;
    expect(tech?.points[0].x).toBeCloseTo(originX, 6);
    expect(tech?.gaps).toHaveLength(1);
  });
});
