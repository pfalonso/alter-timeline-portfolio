import { describe, expect, it } from 'vitest';
import { PartialDate, Timeline } from '../../../src/domain/model';
import { TimelineFactory } from '../../../src/domain/services';
import { makeData, makeEvent, NOW } from '../../helpers/fixtures';

const factory = new TimelineFactory();

describe('Timeline', () => {
  it('ordena los eventos por fecha de inicio y, a igualdad, por id', () => {
    const data = makeData();
    data.events = [
      makeEvent({ id: 'zeta', date: { start: '2012' } }),
      makeEvent({ id: 'late', date: { start: '2015-02' } }),
      makeEvent({ id: 'alfa', date: { start: '2012-01-01' } }),
      makeEvent({ id: 'early', date: { start: '2011-12-31' } }),
    ];
    expect(factory.create(data, { now: NOW }).events.map((event) => event.id)).toEqual(['early', 'alfa', 'zeta', 'late']);
  });

  it('no muta las listas de entrada', () => {
    const data = makeData();
    const timeline = factory.create(data, { now: NOW });
    expect(timeline.events).not.toBe(data.events);
    expect(timeline.categories).not.toBe(data.categories);
    expect(timeline.categories).toEqual(data.categories);
  });

  it('busca eventos y categorías por id', () => {
    const timeline = factory.create(makeData(), { now: NOW });
    expect(timeline.getEvent('b-job')?.title).toBe('Primer trabajo');
    expect(timeline.getEvent('nope')).toBeUndefined();
    expect(timeline.getCategory('play')?.label).toBe('Juego');
    expect(timeline.getCategory('nope')).toBeUndefined();
  });

  it('categoriesOf conserva el orden del evento; primaryCategoryOf es la primera', () => {
    const timeline = factory.create(makeData(), { now: NOW });
    const job = timeline.getEvent('b-job');
    if (!job) throw new Error('falta b-job');
    expect(timeline.categoriesOf(job).map((category) => category.id)).toEqual(['work', 'study']);
    expect(timeline.primaryCategoryOf(job)?.id).toBe('work');
  });

  it('categoriesOf ignora categorías que no existen en el agregado', () => {
    const data = makeData();
    const full = factory.create(data, { now: NOW });
    const partial = new Timeline(data.meta, [data.categories[1]], full.events, PartialDate.fromDate(NOW));
    const job = partial.getEvent('b-job');
    if (!job) throw new Error('falta b-job');
    expect(partial.categoriesOf(job).map((category) => category.id)).toEqual(['study']);
    expect(partial.primaryCategoryOf(job)).toBeUndefined();
  });

  it('branchIds: main primero aunque no tenga eventos, luego por orden de aparición', () => {
    const timeline = factory.create(makeData(), { now: NOW });
    expect(timeline.branchIds).toEqual(['main', 'side']);
    const data = makeData();
    data.events = [makeEvent({ id: 'solo', branch: 'zz' }), makeEvent({ id: 'otro', branch: 'aa', date: { start: '2013' } })];
    expect(factory.create(data, { now: NOW }).branchIds).toEqual(['main', 'zz', 'aa']);
  });

  it('eventsOfBranch devuelve los eventos de la rama en orden cronológico', () => {
    const timeline = factory.create(makeData(), { now: NOW });
    expect(timeline.eventsOfBranch('side').map((event) => event.id)).toEqual(['c-side', 'e-side-two']);
    expect(timeline.eventsOfBranch('main').map((event) => event.id)).toEqual(['a-school', 'b-job']);
    expect(timeline.eventsOfBranch('nope')).toEqual([]);
  });

  it('countByCategory cuenta cada evento en todas sus categorías e incluye las vacías', () => {
    const publicCounts = factory.create(makeData(), { now: NOW }).countByCategory();
    expect(Object.fromEntries(publicCounts)).toEqual({ work: 2, study: 2, play: 2 });
    const data = makeData();
    data.categories.push({ id: 'empty', label: 'Vacía', color: '#000000' });
    const counts = factory.create(data, { now: NOW, includePrivate: true }).countByCategory();
    expect(Object.fromEntries(counts)).toEqual({ work: 2, study: 2, play: 3, empty: 0 });
  });

  describe('yearRange', () => {
    it('sin eventos: el último año hasta hoy', () => {
      const data = makeData();
      data.events = [];
      expect(factory.create(data, { now: NOW }).yearRange).toEqual({ start: 2019, end: 2020 });
    });

    it('con un evento en curso llega hasta hoy', () => {
      expect(factory.create(makeData(), { now: NOW }).yearRange).toEqual({ start: 2010, end: 2020 });
    });

    it('sin eventos en curso termina en el último inicio o fin', () => {
      const data = makeData();
      data.events = [
        makeEvent({ id: 'a', date: { start: '2011', end: '2016-01' } }),
        makeEvent({ id: 'b', date: { start: '2013' } }),
      ];
      expect(factory.create(data, { now: NOW }).yearRange).toEqual({ start: 2011, end: 2016 });
      data.events = [makeEvent({ id: 'b', date: { start: '2013' } })];
      expect(factory.create(data, { now: NOW }).yearRange).toEqual({ start: 2013, end: 2013 });
    });
  });
});
