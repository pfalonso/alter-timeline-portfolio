import { describe, expect, it } from 'vitest';
import { CategorySelection } from '../../../src/domain/model';
import { EventFilter, TimelineFactory } from '../../../src/domain/services';
import { makeData, NOW } from '../../helpers/fixtures';

const IDS = ['work', 'study', 'play'];
const timeline = new TimelineFactory().create(makeData(), { now: NOW });
const filter = new EventFilter();

describe('EventFilter', () => {
  it('con todas las categorías pasan todos los eventos, en orden cronológico', () => {
    const visible = filter.visibleEvents(timeline, CategorySelection.all(IDS));
    expect(visible.map((event) => event.id)).toEqual(['a-school', 'b-job', 'c-side', 'e-side-two']);
  });

  it('sin categorías no pasa ninguno', () => {
    expect(filter.visibleEvents(timeline, CategorySelection.none(IDS))).toEqual([]);
    expect(filter.visibleEventIds(timeline, CategorySelection.none(IDS)).size).toBe(0);
  });

  it('basta con que UNA categoría del evento esté activa (no hace falta la principal)', () => {
    const onlyWork = CategorySelection.all(IDS).only('work');
    expect([...filter.visibleEventIds(timeline, onlyWork)].sort()).toEqual(['b-job', 'e-side-two']);
    const onlyStudy = CategorySelection.all(IDS).only('study');
    expect([...filter.visibleEventIds(timeline, onlyStudy)].sort()).toEqual(['a-school', 'b-job']);
  });

  it('matches evalúa un evento suelto', () => {
    const job = timeline.getEvent('b-job');
    const side = timeline.getEvent('c-side');
    if (!job || !side) throw new Error('faltan eventos');
    const withoutPlay = CategorySelection.all(IDS).toggle('play');
    expect(filter.matches(job, withoutPlay)).toBe(true);
    expect(filter.matches(side, withoutPlay)).toBe(false);
  });
});
