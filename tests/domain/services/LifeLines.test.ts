import { describe, expect, it } from 'vitest';
import { formatIssue } from '../../../src/domain/errors';
import type { BranchInfoData, LifeData } from '../../../src/domain/model';
import { FOCUS_OUT, LifeDataValidator, TimelineFactory, TimelineLayout } from '../../../src/domain/services';
import { makeData, makeEvent, makeLifeLinesData as lifeLines, NOW } from '../../helpers/fixtures';

const validator = new LifeDataValidator();
const issues = (data: unknown): string[] => validator.validate(data).issues.map(formatIssue);
const lines = (data: LifeData): BranchInfoData[] => data.branches as BranchInfoData[];
const build = (data: LifeData, includePrivate = false) =>
  new TimelineFactory().create(validator.assertValid(data), { now: NOW, includePrivate });

describe('LifeDataValidator — branches[] y meta.mainBranch', () => {
  it('acepta el modelo de líneas vitales completo', () => {
    expect(issues(lifeLines())).toEqual([]);
  });

  it('acumula todos los errores de las líneas con su ruta', () => {
    const data = lifeLines((d) => {
      d.branches = [
        { id: 'core', label: 'Oficio' },
        { id: 'core', label: '' },
        { id: 'Arte', label: 'x', color: 'rosa' },
        { id: 'ghost', label: 'Sin eventos' },
        { id: 'art', label: 'Arte', origin: 'no-existe', mergeInto: { branch: 'nada', event: 'tampoco' }, until: 'present' },
        { id: 'food', label: 'Cocina', origin: 'bread', focus: [{ start: '2012', end: '2011' }, { start: 'ayer' }, { start: '2010', level: 5 as 1 }] },
      ];
    });
    expect(issues(data)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('branches[1].id'),
        expect.stringContaining('branches[1].label'),
        expect.stringContaining('branches[2].id'),
        expect.stringContaining('branches[2].color'),
        expect.stringContaining('branches[3].id'),
        expect.stringContaining('branches[4].origin'),
        expect.stringContaining('branches[4].mergeInto.branch'),
        expect.stringContaining('branches[4].mergeInto.event'),
        expect.stringContaining('branches[4].until'),
        expect.stringContaining('branches[5].origin'),
        expect.stringContaining('branches[5].focus[0].end'),
        expect.stringContaining('branches[5].focus[1].start'),
        expect.stringContaining('branches[5].focus[2].level'),
      ]),
    );
  });

  it('una línea solo puede fusionarse con otra existente, en un evento de esa línea', () => {
    expect(issues(lifeLines((d) => (lines(d)[1].mergeInto = { branch: 'art', event: 'show' })))).toEqual([
      expect.stringContaining('consigo misma'),
    ]);
    expect(issues(lifeLines((d) => (lines(d)[1].mergeInto = { branch: 'core', event: 'bread' })))).toEqual([
      expect.stringContaining('no pertenece a la línea "core"'),
    ]);
    expect(issues(lifeLines((d) => (lines(d)[1].mergeInto = 'core' as never)))).toEqual([
      expect.stringContaining('{ branch, event }'),
    ]);
  });

  it('until solo admite "present" y no se combina con mergeInto', () => {
    expect(issues(lifeLines((d) => (lines(d)[1].until = 'present')))).toEqual([expect.stringContaining('no admite until')]);
    expect(issues(lifeLines((d) => (lines(d)[2].until = 'forever' as 'present')))).toEqual([
      expect.stringContaining('solo admite "present"'),
    ]);
  });

  it('detecta ciclos de fusión', () => {
    const data = lifeLines((d) => {
      lines(d)[1].mergeInto = { branch: 'food', event: 'bread' };
      lines(d)[2] = { id: 'food', label: 'Cocina', mergeInto: { branch: 'art', event: 'show' } };
    });
    expect(issues(data)).toEqual([expect.stringContaining('las fusiones forman un ciclo')]);
  });

  it('detecta ciclos de nacimiento entre origin y branchFrom', () => {
    const data = lifeLines((d) => {
      lines(d)[1].origin = 'bread';
      lines(d)[2].origin = 'show';
    });
    expect(issues(data)).toEqual([expect.stringContaining('ciclo de bifurcaciones')]);
  });

  it('la línea central no nace de otra ni se fusiona', () => {
    const data = lifeLines((d) => {
      lines(d)[0].origin = 'drawing';
      lines(d)[0].mergeInto = { branch: 'art', event: 'show' };
    });
    expect(issues(data)).toEqual([
      expect.stringContaining('branches[0].origin'),
      expect.stringContaining('branches[0].mergeInto'),
    ]);
  });

  it('meta.mainBranch: kebab-case y con eventos; sin él, con líneas declaradas, "main" debe tener eventos', () => {
    expect(issues(lifeLines((d) => (d.meta.mainBranch = 'Core')))).toEqual(
      expect.arrayContaining([expect.stringContaining('meta.mainBranch')]),
    );
    const noCore = lifeLines((d) => {
      d.meta.mainBranch = 'nadie';
      for (const event of d.events) event.branch ??= 'core';
    });
    expect(issues(noCore)).toEqual([expect.stringContaining('ningún evento pertenece a la línea central "nadie"')]);
    const implicit = lifeLines((d) => {
      delete d.meta.mainBranch;
      for (const event of d.events) event.branch ??= 'core';
    });
    expect(issues(implicit)).toEqual([expect.stringContaining('indica cuál es la línea central')]);
  });

  it('branches debe ser una lista de objetos', () => {
    expect(issues(lifeLines((d) => (d.branches = {} as never)))).toEqual([expect.stringContaining('branches')]);
    expect(issues(lifeLines((d) => (d.branches = ['x'] as never)))).toEqual([expect.stringContaining('branches[0]')]);
    expect(issues(lifeLines((d) => (lines(d)[1].focus = 'siempre' as never)))).toEqual([expect.stringContaining('focus')]);
    expect(issues(lifeLines((d) => (lines(d)[1].focus = ['x'] as never)))).toEqual([expect.stringContaining('focus[0]')]);
  });

  it('los datos antiguos (sin branches ni mainBranch) siguen validando igual', () => {
    expect(issues(makeData())).toEqual([]);
  });
});

describe('Timeline y TimelineFactory con líneas vitales', () => {
  it('los eventos sin branch van a la línea central y esta encabeza branchIds; después, el orden declarado', () => {
    const timeline = build(lifeLines());
    expect(timeline.mainBranch).toBe('core');
    expect(timeline.getEvent('degree')?.branch).toBe('core');
    expect(timeline.branchIds).toEqual(['core', 'art', 'food', 'teach']);
  });

  it('normaliza las líneas: foco con nivel por defecto 3 y fin abierto; fusión; until', () => {
    const timeline = build(lifeLines());
    const food = timeline.getLine('food');
    expect(food?.untilPresent).toBe(true);
    expect(food?.focus[0].level).toBe(3);
    expect(timeline.getLine('core')?.focus[0].end).toBeNull();
    expect(timeline.getLine('art')?.mergeInto).toEqual({ branch: 'core', eventId: 'master' });
  });

  it('color de línea: el declarado o el de la categoría principal de su primer evento', () => {
    const timeline = build(lifeLines());
    expect(timeline.lineColorOf('food')).toBe('#7BE0A4');
    expect(timeline.lineColorOf('art')).toBe('#FF7EB6');
    expect(timeline.lineColorOf('nada')).toBeUndefined();
  });

  it('origin prevalece sobre branchFrom; si está oculto se usa branchFrom', () => {
    const data = lifeLines((d) => {
      d.events.find((e) => e.id === 'class')!.branchFrom = 'degree';
    });
    expect(build(data).originOf('teach')?.id).toBe('birth');
    const hidden = lifeLines((d) => {
      d.events.find((e) => e.id === 'class')!.branchFrom = 'degree';
      d.events.find((e) => e.id === 'birth')!.visibility = 'private';
    });
    expect(build(hidden).originOf('teach')?.id).toBe('degree');
    expect(build(hidden, true).originOf('teach')?.id).toBe('birth');
    expect(build(hidden).originOf('core')).toBeUndefined();
  });

  it('mergeOf solo resuelve fusiones cuyo evento es visible', () => {
    expect(build(lifeLines()).mergeOf('art')?.event.id).toBe('master');
    const hidden = lifeLines((d) => (d.events.find((e) => e.id === 'master')!.visibility = 'private'));
    expect(build(hidden).mergeOf('art')).toBeUndefined();
    expect(build(lifeLines()).mergeOf('food')).toBeUndefined();
  });
});

describe('TimelineLayout con líneas vitales', () => {
  const layoutOf = (data: LifeData) => new TimelineLayout().compute(build(data));

  it('la línea central va en el carril 0 aunque no se llame "main"', () => {
    const layout = layoutOf(lifeLines());
    const core = layout.branches.find((branch) => branch.id === 'core');
    expect(core?.main).toBe(true);
    expect(core?.lane).toBe(0);
    expect(layout.branches.filter((branch) => branch.main)).toHaveLength(1);
    expect(new Set(layout.branches.map((branch) => branch.lane)).size).toBe(layout.branches.length);
  });

  it('las líneas con origin nacen todas del mismo punto (el nacimiento) y se abren como un haz', () => {
    const layout = layoutOf(lifeLines());
    const birth = layout.nodes.find((node) => node.eventId === 'birth')?.position;
    for (const id of ['art', 'food', 'teach']) {
      const branch = layout.branches.find((item) => item.id === id);
      expect(branch?.originEventId).toBe('birth');
      expect(branch?.points[0]).toEqual(birth);
      // Se separa poco a poco: a un año aún está cerca del nacimiento.
      const oneYear = branch?.points.find((point) => point.x >= (birth?.x ?? 0) + 5);
      expect(Math.abs((oneYear?.y ?? 0) - (birth?.y ?? 0))).toBeLessThan(Math.abs(branch?.lane ?? 0) * layout.laneSpacing * 0.6);
    }
  });

  it('una línea que se fusiona termina en el punto de la línea destino a la altura del evento', () => {
    const layout = layoutOf(lifeLines());
    const art = layout.branches.find((branch) => branch.id === 'art');
    const master = layout.nodes.find((node) => node.eventId === 'master');
    expect(art?.open).toBe(false);
    expect(art?.merge).toEqual({ into: 'core', eventId: 'master', position: master?.position });
    expect(art?.points[art.points.length - 1]).toEqual(master?.position);
    // Antes de la curva de convergencia va por su carril.
    const before = art?.points.find((point) => point.x > (master?.position.x ?? 0) - 25);
    expect(Math.abs(before?.y ?? 0)).toBeGreaterThan(layout.laneSpacing * 0.5);
  });

  it('until: "present" lleva la línea hasta hoy; sin until, una línea cerrada se corta (y se disuelve)', () => {
    const layout = layoutOf(lifeLines());
    const food = layout.branches.find((branch) => branch.id === 'food');
    const teach = layout.branches.find((branch) => branch.id === 'teach');
    expect(food?.open).toBe(true);
    expect(food?.points[food.points.length - 1].x).toBeGreaterThan(layout.nowX);
    expect(teach?.open).toBe(false);
    expect(teach?.merge).toBeNull();
    expect(teach?.points[teach.points.length - 1].x).toBeLessThan(layout.nowX);
  });

  it('cada punto lleva su intensidad de foco: tenue fuera, plena dentro, 1 sin periodos', () => {
    const layout = layoutOf(lifeLines());
    const food = layout.branches.find((branch) => branch.id === 'food');
    const teach = layout.branches.find((branch) => branch.id === 'teach');
    expect(food?.focus).toHaveLength(food?.points.length ?? -1);
    expect(Math.min(...(food?.focus ?? []))).toBe(FOCUS_OUT);
    expect(Math.max(...(food?.focus ?? []))).toBe(1);
    expect(teach?.focus.every((value) => value === 1)).toBe(true);
    // La central está en foco hoy.
    const core = layout.branches.find((branch) => branch.id === 'core');
    expect(core?.focus[core.focus.length - 1]).toBe(1);
  });

  it('si el evento de fusión está oculto la línea se comporta como una rama cerrada', () => {
    const data = lifeLines((d) => (d.events.find((e) => e.id === 'master')!.visibility = 'private'));
    const art = layoutOf(data).branches.find((branch) => branch.id === 'art');
    expect(art?.merge).toBeNull();
    expect(art?.open).toBe(false);
  });

  it('ignora una fusión anterior al nacimiento de la línea', () => {
    const data = lifeLines((d) => {
      d.events.push(makeEvent({ id: 'early', date: { start: '1999' } }));
      lines(d)[1].mergeInto = { branch: 'core', event: 'early' };
    });
    expect(layoutOf(data).branches.find((branch) => branch.id === 'art')?.merge).toBeNull();
  });

  it('una línea que converge en otra lateral queda a su lado (sin cruzar el tronco)', () => {
    const data = lifeLines((d) => {
      d.events.push(makeEvent({ id: 'later', date: { start: '2014' }, branch: 'food' }));
      lines(d)[3].mergeInto = { branch: 'food', event: 'later' };
      d.events.find((e) => e.id === 'class')!.date = { start: '2009' };
    });
    expect(issues(data)).toEqual([]);
    const layout = layoutOf(data);
    const food = layout.branches.find((branch) => branch.id === 'food');
    const teach = layout.branches.find((branch) => branch.id === 'teach');
    expect(Math.sign(teach?.lane ?? 0)).toBe(Math.sign(food?.lane ?? 0));
    const later = layout.nodes.find((node) => node.eventId === 'later');
    expect(teach?.points[teach.points.length - 1]).toEqual(later?.position);
  });

  it('es determinista', () => {
    const timeline = build(lifeLines());
    expect(new TimelineLayout().compute(timeline)).toEqual(new TimelineLayout().compute(timeline));
  });
});
