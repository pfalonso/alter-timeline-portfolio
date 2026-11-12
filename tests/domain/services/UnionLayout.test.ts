import { describe, expect, it } from 'vitest';
import type { LifeData } from '../../../src/domain/model';
import { branchPieces, LifeDataValidator, TimelineFactory, TimelineLayout, type TimelineLayoutResult, type Vec3 } from '../../../src/domain/services';
import { makeUnionData } from '../../helpers/unionFixtures';

const NOW = new Date(Date.UTC(2020, 0, 1));
const layoutOf = (data: LifeData = makeUnionData()): TimelineLayoutResult => {
  const timeline = new TimelineFactory().create(new LifeDataValidator().assertValid(data), { now: NOW });
  return new TimelineLayout().compute(timeline);
};
const nodeOf = (layout: TimelineLayoutResult, id: string) => {
  const node = layout.nodes.find((item) => item.eventId === id);
  if (!node) throw new Error(id);
  return node;
};
const branchOf = (layout: TimelineLayoutResult, id: string) => {
  const branch = layout.branches.find((item) => item.id === id);
  if (!branch) throw new Error(id);
  return branch;
};
const pointAt = (points: readonly Vec3[], x: number): Vec3 | undefined => points.find((point) => Math.abs(point.x - x) < 1e-3);

describe('TimelineLayout: nodos de unión', () => {
  const layout = layoutOf();

  it('todas las líneas de un nodo de unión pasan exactamente por él', () => {
    for (const id of ['e-cross', 'e-accident', 'e-recovery']) {
      const node = nodeOf(layout, id);
      expect(node.lines.length).toBeGreaterThan(2);
      for (const line of node.lines) {
        const point = pointAt(branchOf(layout, line).points, node.position.x);
        expect(point, `${line} en ${id}`).toBeDefined();
        expect(point?.y).toBeCloseTo(node.position.y, 6);
      }
    }
    expect(nodeOf(layout, 'e-accident').lines).toEqual(['vida', 'tech', 'arte', 'cocina']);
  });

  it('tras un nudo, la línea va a su carril si su siguiente nodo está fuera de la banda; si está en la banda y cerca, sigue por la banda', () => {
    const step = layout.nodeStep;
    for (const branch of layout.branches) {
      if (branch.laneY === 0) continue;
      const own = layout.nodes
        .filter((node) => node.lines.includes(branch.id))
        .sort((a, b) => a.position.x - b.position.x);
      for (let i = 0; i + 1 < own.length; i += 1) {
        const a = own[i].position;
        const b = own[i + 1].position;
        const mid = branch.points.filter((point) => point.x > a.x + 1e-6 && point.x < b.x - 1e-6);
        if (mid.length === 0) continue;
        if (a.y === 0 && b.y === 0 && b.x - a.x <= 6 * step + 1e-6) {
          // Puente por la banda: nunca sale de ella (salvo que el foco cambie entre medias).
          const focusChanges = branch.focus.some((value, k) => k > 0 && value !== branch.focus[k - 1]);
          if (!focusChanges) for (const point of mid) expect(point.y).toBe(0);
        } else if (b.y !== 0 && a.y !== 0) {
          for (const point of mid) expect(Math.abs(point.y)).toBeLessThanOrEqual(Math.abs(branch.laneY) + 1e-6);
        }
      }
    }
    // El nudo no arrastra a una línea cuyo siguiente nodo está en su carril.
    const arte = branchOf(layout, 'arte');
    const cross = nodeOf(layout, 'e-cross').position.x;
    const nextArt = layout.nodes
      .filter((node) => node.lines.includes('arte') && node.position.x > cross)
      .sort((a, b) => a.position.x - b.position.x)[0];
    if (nextArt && nextArt.position.y !== 0) {
      const after = pointAt(arte.points, cross + step);
      expect(after?.y).toBeCloseTo(arte.laneY, 6);
    }
  });

  it('sin chispas de unión/separación en los nudos', () => {
    const knots = ['e-cross', 'e-accident', 'e-recovery'].map((id) => nodeOf(layout, id).position.x);
    for (const junction of layout.junctions.filter((item) => item.kind === 'join' || item.kind === 'split')) {
      for (const x of knots) expect(Math.abs(junction.position.x - x)).toBeGreaterThan(1e-3);
    }
  });

  it('y = 0 si alguna línea de alsoBranches está en la trenza aunque la dueña no lo esté', () => {
    const data = makeUnionData();
    data.events.push({ id: 'e-joint', title: 'j', date: { start: '2017-06' }, categories: ['c'], summary: 's', branch: 'arte', alsoBranches: ['tech'] });
    const result = layoutOf(data);
    expect(nodeOf(result, 'e-joint').position.y).toBe(0);
    // La dueña sola (arte, fuera de foco) va en su carril.
    expect(nodeOf(result, 'e-art2').position.y).not.toBe(0);
  });

  it('una línea nace en el nodo de su origin, con chispa de nacimiento', () => {
    const cross = nodeOf(layout, 'e-cross').position;
    expect(branchOf(layout, 'cocina').points[0].x).toBeCloseTo(cross.x, 6);
    expect(layout.junctions.some((item) => item.branch === 'cocina' && item.kind === 'birth' && Math.abs(item.position.x - cross.x) < 1e-3)).toBe(true);
  });
});

describe('TimelineLayout: pausas', () => {
  const layout = layoutOf();
  const accident = nodeOf(layout, 'e-accident').position.x;
  const recovery = nodeOf(layout, 'e-recovery').position.x;

  it('la línea no tiene puntos dentro de la pausa: se disuelve poco después de from y renace en to', () => {
    for (const id of ['tech', 'arte', 'cocina']) {
      const branch = branchOf(layout, id);
      expect(branch.gaps).toHaveLength(1);
      const gap = branch.gaps[0];
      expect(gap.toX).toBeCloseTo(recovery, 6);
      expect(gap.fromX - accident).toBeGreaterThan(0);
      expect(gap.fromX - accident).toBeLessThanOrEqual(layout.nodeStep * 0.55 + 1e-6);
      expect(branch.points.filter((point) => point.x > gap.fromX + 1e-6 && point.x < gap.toX - 1e-6)).toEqual([]);
      expect(branchPieces(branch)).toHaveLength(2);
      expect(layout.junctions.filter((item) => item.branch === id && item.kind === 'fray')).toHaveLength(1);
    }
    // La vida sigue entera.
    expect(branchOf(layout, 'vida').gaps).toEqual([]);
    expect(branchPieces(branchOf(layout, 'vida'))).toHaveLength(1);
  });

  it('durante la pausa la línea no cuenta en la trenza', () => {
    const middle = accident + (recovery - accident) * 0.8;
    const span = layout.braidSpans.find((item) => middle >= item.startX && middle <= item.endX);
    expect(span?.members).not.toContain('tech');
  });
});

describe('TimelineLayout: caminos que no fueron y proyectos activos', () => {
  const layout = layoutOf();

  it('los ghosts salen de su origen, uno hacia cada lado, y su longitud está acotada', () => {
    const cross = nodeOf(layout, 'e-cross').position;
    expect(layout.ghosts.map((ghost) => ghost.id)).toEqual(['derecho', 'arquitectura']);
    expect(layout.ghosts.map((ghost) => ghost.side)).toEqual([1, -1]);
    for (const ghost of layout.ghosts) {
      expect(ghost.points[0]).toMatchObject({ x: cross.x, y: cross.y });
      const length = ghost.points[ghost.points.length - 1].x - ghost.points[0].x;
      expect(length).toBeGreaterThanOrEqual(layout.nodeStep);
      expect(length).toBeLessThanOrEqual(layout.nodeStep * 1.5);
    }
    // No son líneas: no salen en branches (ni en la leyenda).
    expect(layout.branches.some((branch) => branch.id === 'derecho')).toBe(false);
  });

  it('un ghost sin origen visible no se dibuja', () => {
    const timeline = new TimelineFactory().create(new LifeDataValidator().assertValid(makeUnionData()), { now: NOW });
    const visible = new Set(timeline.events.filter((event) => event.id !== 'e-cross').map((event) => event.id));
    expect(new TimelineLayout().compute(timeline, visible).ghosts).toEqual([]);
  });

  it('un proyecto activo prolonga su línea hasta el final', () => {
    expect(layout.actives.map((active) => active.eventId)).toEqual(['e-tech2']);
    const active = layout.actives[0];
    expect(active.points[0].x).toBeCloseTo(nodeOf(layout, 'e-tech2').position.x, 6);
    expect(active.points[active.points.length - 1].x).toBeCloseTo(layout.bounds.maxX, 6);
    expect(branchOf(layout, 'tech').open).toBe(true);
  });

  it('un activo en una línea cerrada también la deja abierta', () => {
    const data = makeUnionData();
    const art2 = data.events.find((event) => event.id === 'e-art2');
    if (art2) art2.active = true;
    expect(branchOf(layoutOf(data), 'arte').open).toBe(true);
  });
});
