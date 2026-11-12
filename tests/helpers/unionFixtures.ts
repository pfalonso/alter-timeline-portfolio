import type { LifeData, LifeEventData } from '../../src/domain/model';

const ev = (id: string, start: string, branch: string, extra: Partial<LifeEventData> = {}): LifeEventData => ({
  id,
  title: id,
  date: { start },
  categories: ['c'],
  summary: `Evento ${id}.`,
  branch,
  ...extra,
});

/**
 * Historia con nodos de unión: tres líneas convergen en `e-cross` (donde nace `cocina` y salen dos
 * caminos que no fueron), las cuatro en `e-accident`, tras el que todas salvo `vida` se pausan hasta
 * `e-recovery`, y un proyecto activo (`e-tech2`).
 */
export function makeUnionData(): LifeData {
  return {
    schemaVersion: 1,
    meta: { owner: 'Ada', title: 'Uniones', locale: 'es', mainBranch: 'vida' },
    categories: [{ id: 'c', label: 'Cat', color: '#ffffff' }],
    events: [
      ev('e-birth', '2000', 'vida'),
      ev('e-tech1', '2004', 'tech'),
      ev('e-art1', '2005', 'arte'),
      ev('e-cross', '2008', 'vida', { alsoBranches: ['tech', 'arte'], importance: 3 }),
      ev('e-cook1', '2009', 'cocina'),
      ev('e-accident', '2012', 'vida', { alsoBranches: ['tech', 'arte', 'cocina'] }),
      ev('e-recovery', '2014', 'vida', { alsoBranches: ['tech', 'arte', 'cocina'] }),
      ev('e-tech2', '2016', 'tech', { date: { start: '2016', end: 'present' }, active: true }),
      ev('e-art2', '2017', 'arte'),
      ev('e-cook2', '2018', 'cocina'),
    ],
    branches: [
      { id: 'vida', label: 'Vida', color: '#cccccc' },
      { id: 'tech', label: 'Tecnología', color: '#55aaff', focus: [{ start: '2015' }], pauses: [{ from: 'e-accident', to: 'e-recovery' }] },
      { id: 'arte', label: 'Arte', color: '#ff66aa', pauses: [{ from: 'e-accident', to: 'e-recovery' }] },
      { id: 'cocina', label: 'Cocina', color: '#77dd99', origin: 'e-cross', pauses: [{ from: 'e-accident', to: 'e-recovery' }] },
      { id: 'derecho', label: 'Derecho', color: '#aaaaaa', origin: 'e-cross', ghost: true },
      { id: 'arquitectura', label: 'Arquitectura', color: '#bbbbbb', origin: 'e-cross', ghost: true },
    ],
  };
}

/** Acceso laxo para mutar el fixture en los tests de validación. */
export type LooseData = {
  events: (Record<string, unknown> & { id: string })[];
  branches: (Record<string, unknown> & { id: string })[];
  [key: string]: unknown;
};

export function looseUnionData(mutate: (data: LooseData) => void): unknown {
  const data = makeUnionData() as unknown as LooseData;
  mutate(data);
  return data;
}

export const eventOf = (data: LooseData, id: string): Record<string, unknown> => data.events.find((event) => event.id === id) as Record<string, unknown>;
export const lineOf = (data: LooseData, id: string): Record<string, unknown> => data.branches.find((line) => line.id === id) as Record<string, unknown>;
