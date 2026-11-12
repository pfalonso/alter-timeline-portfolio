import { describe, expect, it } from 'vitest';
import { LifeDataValidator } from '../../../src/domain/services';
import { eventOf, lineOf, looseUnionData, makeUnionData, type LooseData } from '../../helpers/unionFixtures';

const validator = new LifeDataValidator();
const issuesOf = (mutate: (data: LooseData) => void): string[] =>
  validator.validate(looseUnionData(mutate)).issues.map((issue) => `${issue.path}: ${issue.message}`);

describe('LifeDataValidator: nodos de unión, caminos que no fueron, pausas y activos', () => {
  it('acepta el fixture completo', () => {
    expect(validator.validate(makeUnionData()).issues).toEqual([]);
  });

  it('alsoBranches: líneas existentes, sin la dueña ni duplicados, y en forma de lista', () => {
    const issues = issuesOf((data) => {
      eventOf(data, 'e-cross').alsoBranches = ['tech', 'nadie', 'vida', 'tech', 3];
      eventOf(data, 'e-art2').alsoBranches = 'tech';
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/events\[3\]\.alsoBranches\[1\]: la línea "nadie" no existe/),
        expect.stringMatching(/events\[3\]\.alsoBranches\[2\]: "vida" es la línea dueña/),
        expect.stringMatching(/events\[3\]\.alsoBranches\[3\]: "tech" está repetida/),
        expect.stringMatching(/events\[3\]\.alsoBranches\[4\]: debe ser el id/),
        expect.stringMatching(/events\[8\]\.alsoBranches: debe ser una lista/),
      ]),
    );
  });

  it('la línea debe estar viva: nacida, sin terminar, sin fusionar y sin pausa', () => {
    const issues = issuesOf((data) => {
      eventOf(data, 'e-art1').alsoBranches = ['cocina']; // cocina nace en 2008
      Object.assign(eventOf(data, 'e-cook2'), { alsoBranches: ['arte'], date: { start: '2019' } }); // arte termina en 2017
      data.events.push({ id: 'e-mid', title: 'm', date: { start: '2013' }, categories: ['c'], summary: 's', branch: 'vida', alsoBranches: ['tech'] });
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/events\[2\]\.alsoBranches\[0\]: la línea "cocina" no está viva en 2005: aún no ha nacido/),
        expect.stringMatching(/events\[9\]\.alsoBranches\[0\]: la línea "arte" no está viva en 2019: ya ha terminado/),
        expect.stringMatching(/events\[10\]\.alsoBranches\[0\]: la línea "tech" no está viva en 2013: está en pausa/),
      ]),
    );
    expect(issues).toHaveLength(3);
  });

  it('una línea fusionada ya no pasa por nodos posteriores; until "present" la mantiene viva', () => {
    const merged = issuesOf((data) => {
      lineOf(data, 'arte').mergeInto = { branch: 'vida', event: 'e-recovery' };
      eventOf(data, 'e-art2').branch = 'cocina';
      eventOf(data, 'e-cook2').alsoBranches = ['arte'];
    });
    expect(merged.join('\n')).toMatch(/"arte" no está viva en 2018: se fusiona en "e-recovery"/);
    expect(issuesOf((data) => {
      lineOf(data, 'arte').until = 'present';
      eventOf(data, 'e-cook2').alsoBranches = ['arte'];
    })).toEqual([]);
  });

  it('una línea que solo aparece en nodos de unión cuenta como usada', () => {
    expect(issuesOf((data) => {
      data.branches.push({ id: 'viajes', label: 'Viajes' });
      eventOf(data, 'e-cook1').alsoBranches = ['viajes'];
    })).toEqual([]);
  });

  it('ghost: exige origin y prohíbe eventos propios, until, mergeInto, pauses y pasar por uniones', () => {
    const issues = issuesOf((data) => {
      delete lineOf(data, 'derecho').origin;
      Object.assign(lineOf(data, 'arquitectura'), { until: 'present', pauses: [], mergeInto: { branch: 'vida', event: 'e-birth' } });
      eventOf(data, 'e-cook2').branch = 'arquitectura';
      eventOf(data, 'e-art2').alsoBranches = ['derecho'];
      data.branches.push({ id: 'otra', label: 'Otra', ghost: 'sí' });
    });
    const text = issues.join('\n');
    expect(text).toMatch(/branches\[4\]\.ghost: un camino que no fue necesita origin/);
    expect(text).toMatch(/branches\[5\]\.ghost: un camino que no fue no tiene eventos propios/);
    for (const key of ['until', 'mergeInto', 'pauses']) expect(text).toContain(`branches[5].${key}: un camino que no fue (ghost) no admite ${key}`);
    expect(text).toMatch(/alsoBranches\[0\]: "derecho" es un camino que no fue/);
    expect(text).toMatch(/branches\[6\]\.ghost: debe ser true o false/);
  });

  it('pauses: eventos existentes, from anterior a to, sin solapes ni eventos propios dentro', () => {
    const issues = issuesOf((data) => {
      lineOf(data, 'tech').pauses = [
        { from: 'e-accident', to: 'e-recovery' },
        { from: 'e-cross', to: 'e-recovery' },
        { from: 'e-recovery', to: 'e-cross' },
        { from: 'nada', to: 7 },
        'x',
      ];
      lineOf(data, 'arte').pauses = [{ from: 'e-birth', to: 'e-cross' }];
      lineOf(data, 'cocina').pauses = 'no';
    });
    const text = issues.join('\n');
    expect(text).toMatch(/branches\[1\]\.pauses\[1\]: se solapa|branches\[1\]\.pauses\[0\]: se solapa/);
    expect(text).toMatch(/branches\[1\]\.pauses\[2\]\.to: "e-cross" \(2008\) debe ser posterior a "e-recovery"/);
    expect(text).toMatch(/branches\[1\]\.pauses\[3\]\.from: el evento "nada" no existe/);
    expect(text).toMatch(/branches\[1\]\.pauses\[3\]\.to: es obligatorio/);
    expect(text).toMatch(/branches\[1\]\.pauses\[4\]: debe ser un objeto/);
    expect(text).toMatch(/branches\[2\]\.pauses\[0\]: el evento "e-art1" \(2005\) de la línea cae dentro de la pausa/);
    expect(text).toMatch(/branches\[3\]\.pauses: debe ser una lista/);
  });

  it('active debe ser booleano', () => {
    expect(issuesOf((data) => (eventOf(data, 'e-art2').active = 'sí'))).toEqual(['events[8].active: debe ser true o false']);
  });
});

describe('la línea central (mainBranch) también nace en un nodo y se pausa', () => {
  /** `tech` es la central, nace en `e-cross` y se pausa del accidente a la recuperación. */
  const centralTech = (mutate: (data: LooseData) => void = () => undefined): unknown =>
    looseUnionData((data) => {
      (data.meta as Record<string, unknown>).mainBranch = 'tech';
      Object.assign(lineOf(data, 'tech'), { origin: 'e-cross' });
      eventOf(data, 'e-tech1').branch = 'vida';
      eventOf(data, 'e-cross').alsoBranches = ['arte'];
      mutate(data);
    });

  it('acepta origin y pauses en la central', () => {
    expect(validator.validate(centralTech()).issues).toEqual([]);
  });

  it('antes de nacer la central no pasa por nodos de unión', () => {
    const issues = validator.validate(centralTech((data) => (eventOf(data, 'e-art1').alsoBranches = ['tech']))).issues;
    expect(issues.map((issue) => issue.message).join('\n')).toMatch(/"tech" no está viva en 2005: aún no ha nacido/);
  });
});
