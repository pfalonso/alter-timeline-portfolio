import { vi } from 'vitest';
import type { TimelineViewHandlers, TimelineViewModel } from '../../src/application/ports';
import type { LifeData, LifeEventData } from '../../src/domain/model';
import { LifeDataValidator, TimelineFactory, TimelineLayout } from '../../src/domain/services';

/** "Hoy" fijo para que los tests sean deterministas. */
export const NOW = new Date(Date.UTC(2020, 0, 1));

/**
 * Datos mínimos y válidos: tres categorías, un tronco con un evento en curso, una rama
 * (`side`) que nace de `b-job` y un evento privado.
 */
export function makeData(): LifeData {
  return {
    schemaVersion: 1,
    meta: {
      owner: 'Ada Test',
      title: 'Vida de prueba',
      tagline: 'Una tagline',
      locale: 'es',
      contact: [{ label: 'Web', url: 'https://example.com/ada' }],
    },
    categories: [
      { id: 'work', label: 'Trabajo', color: '#FFB454', icon: '▲', description: 'Empleo' },
      { id: 'study', label: 'Estudios', color: '#6EA8FF' },
      { id: 'play', label: 'Juego', color: '#B48CFF', icon: '✦' },
    ],
    events: [
      {
        id: 'a-school',
        title: 'Escuela',
        date: { start: '2010', end: '2014' },
        categories: ['study'],
        summary: 'Cuatro años de estudio.',
      },
      {
        id: 'b-job',
        title: 'Primer trabajo',
        subtitle: 'Ingeniera · Acme',
        date: { start: '2015-03', end: 'present' },
        categories: ['work', 'study'],
        summary: 'Un trabajo que sigue.',
        description: 'Primer párrafo.\n\nSegundo párrafo.',
        location: 'Donostia',
        organization: 'Acme',
        skills: ['TypeScript', 'three.js'],
        highlights: ['Un hito'],
        links: [{ label: 'Acme', url: 'https://example.com/acme' }],
        importance: 3,
      },
      {
        id: 'c-side',
        title: 'Proyecto paralelo',
        date: { start: '2016-06' },
        categories: ['play'],
        summary: 'Una bifurcación.',
        branch: 'side',
        branchFrom: 'b-job',
        importance: 1,
      },
      {
        id: 'd-secret',
        title: 'Secreto',
        date: { start: '2017' },
        categories: ['play'],
        summary: 'Solo con ?private=1.',
        visibility: 'private',
      },
      {
        id: 'e-side-two',
        title: 'Segunda parte',
        date: { start: '2018-01-15', end: '2018-06' },
        categories: ['play', 'work'],
        summary: 'La rama continúa.',
        branch: 'side',
      },
    ],
  };
}

/**
 * Modelo de «líneas vitales»: todas nacen en el nacimiento y discurren en paralelo; cambia el foco.
 * Central `core`; `art` converge en `core` en el máster; `food` sigue latente hasta hoy; `teach`
 * se cierra.
 */
export function makeLifeLinesData(mutate: (data: LifeData) => void = () => undefined): LifeData {
  const data: LifeData = {
    schemaVersion: 1,
    meta: { owner: 'Ada', title: 'Líneas', locale: 'es', mainBranch: 'core' },
    categories: [
      { id: 'work', label: 'Trabajo', color: '#FFB454' },
      { id: 'art', label: 'Arte', color: '#FF7EB6' },
    ],
    events: [
      makeEvent({ id: 'birth', date: { start: '2000-01' } }),
      makeEvent({ id: 'degree', date: { start: '2010', end: '2014' } }),
      makeEvent({ id: 'master', date: { start: '2016', end: '2017' } }),
      makeEvent({ id: 'job', date: { start: '2017-06', end: 'present' } }),
      makeEvent({ id: 'drawing', date: { start: '2006' }, categories: ['art'], branch: 'art' }),
      makeEvent({ id: 'show', date: { start: '2013' }, categories: ['art'], branch: 'art' }),
      makeEvent({ id: 'bread', date: { start: '2011', end: '2012' }, branch: 'food' }),
      makeEvent({ id: 'class', date: { start: '2015', end: '2016' }, branch: 'teach' }),
    ],
    branches: [
      { id: 'core', label: 'Oficio', focus: [{ start: '2016', end: 'present', level: 3 }] },
      {
        id: 'art',
        label: 'Arte',
        origin: 'birth',
        mergeInto: { branch: 'core', event: 'master' },
        focus: [{ start: '2005', end: '2007', level: 2 }],
      },
      { id: 'food', label: 'Cocina', color: '#7BE0A4', origin: 'birth', until: 'present', focus: [{ start: '2011', end: '2012' }] },
      { id: 'teach', label: 'Enseñar', origin: 'birth' },
    ],
  };
  mutate(data);
  return data;
}

export function makeEvent(overrides: Partial<LifeEventData> & { id: string }): LifeEventData {
  return {
    title: `Evento ${overrides.id}`,
    date: { start: '2012' },
    categories: ['work'],
    summary: 'Resumen.',
    ...overrides,
  };
}

export interface ModelOptions {
  readonly includePrivate?: boolean;
  readonly source?: 'personal' | 'example';
  readonly now?: Date;
}

/** Construye el modelo de vista real (validador + fábrica + layout) a partir de unos datos. */
export function buildModel(data: LifeData = makeData(), options: ModelOptions = {}): TimelineViewModel {
  const valid = new LifeDataValidator().assertValid(data);
  const timeline = new TimelineFactory().create(valid, {
    now: options.now ?? NOW,
    includePrivate: options.includePrivate ?? false,
  });
  return { timeline, layout: new TimelineLayout().compute(timeline), source: options.source ?? 'personal' };
}

export type FakeHandlers = { [K in keyof TimelineViewHandlers]: ReturnType<typeof vi.fn<TimelineViewHandlers[K]>> };

export function fakeHandlers(): FakeHandlers {
  return {
    onCategoryToggled: vi.fn<TimelineViewHandlers['onCategoryToggled']>(),
    onCategorySoloed: vi.fn<TimelineViewHandlers['onCategorySoloed']>(),
    onAllCategories: vi.fn<TimelineViewHandlers['onAllCategories']>(),
    onNoCategories: vi.fn<TimelineViewHandlers['onNoCategories']>(),
    onEventActivated: vi.fn<TimelineViewHandlers['onEventActivated']>(),
    onDetailClosed: vi.fn<TimelineViewHandlers['onDetailClosed']>(),
    onSelectionCleared: vi.fn<TimelineViewHandlers['onSelectionCleared']>(),
    onNavigate: vi.fn<TimelineViewHandlers['onNavigate']>(),
  };
}

/** Estado de selección para las vistas, con valores por defecto. */
export function selection(
  focusedEventId: string | null,
  detailOpen = false,
  neighbours: { hasPrevious?: boolean; hasNext?: boolean } = {},
): { focusedEventId: string | null; detailOpen: boolean; hasPrevious: boolean; hasNext: boolean } {
  return { focusedEventId, detailOpen, hasPrevious: neighbours.hasPrevious ?? true, hasNext: neighbours.hasNext ?? true };
}
