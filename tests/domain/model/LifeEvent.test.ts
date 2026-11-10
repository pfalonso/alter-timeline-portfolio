import { describe, expect, it } from 'vitest';
import { LifeEvent, PartialDate, type LifeEventProps } from '../../../src/domain/model';

function event(overrides: Partial<LifeEventProps> = {}): LifeEvent {
  return new LifeEvent({
    id: 'e',
    title: 'Título',
    start: PartialDate.parse('2019-03'),
    end: null,
    ongoing: false,
    categoryIds: ['work', 'play'],
    summary: 'Resumen',
    skills: [],
    highlights: [],
    links: [],
    media: [],
    importance: 2,
    branch: 'main',
    isPrivate: false,
    ...overrides,
  });
}

describe('LifeEvent', () => {
  it('es inmutable', () => {
    const e = event();
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => {
      (e as { title: string }).title = 'otro';
    }).toThrow(TypeError);
  });

  it('la primera categoría es la principal', () => {
    expect(event().primaryCategoryId).toBe('work');
    expect(event({ categoryIds: [] }).primaryCategoryId).toBe('');
  });

  it('isRange: tiene fin o sigue en curso', () => {
    expect(event().isRange).toBe(false);
    expect(event({ end: PartialDate.parse('2020') }).isRange).toBe(true);
    expect(event({ ongoing: true }).isRange).toBe(true);
  });

  it('hasAnyCategory basta con una coincidencia', () => {
    expect(event().hasAnyCategory(new Set(['play']))).toBe(true);
    expect(event().hasAnyCategory(new Set(['study']))).toBe(false);
    expect(event().hasAnyCategory(new Set())).toBe(false);
  });

  it('paragraphs separa por líneas en blanco y descarta vacíos', () => {
    expect(event().paragraphs).toEqual([]);
    expect(event({ description: '  Uno.  \n\n\n Dos,\ncon salto. \n \n\n' }).paragraphs).toEqual(['Uno.', 'Dos,\ncon salto.']);
  });

  it('formatDateRange: puntual, en curso, con fin y con fin igual al inicio', () => {
    expect(event({ start: PartialDate.parse('2019') }).formatDateRange('es')).toBe('2019');
    expect(event({ start: PartialDate.parse('2019'), ongoing: true }).formatDateRange('es')).toBe('2019 — actualidad');
    expect(event({ start: PartialDate.parse('2019'), ongoing: true }).formatDateRange('en', 'present')).toBe('2019 — present');
    expect(event({ start: PartialDate.parse('2019'), end: PartialDate.parse('2021') }).formatDateRange()).toBe('2019 — 2021');
    expect(event({ start: PartialDate.parse('2019'), end: PartialDate.parse('2019') }).formatDateRange()).toBe('2019');
    expect(event({ end: PartialDate.parse('2020-01') }).formatDateRange('en')).toBe('Mar 2019 — Jan 2020');
  });
});
