import { describe, expect, it } from 'vitest';
import type { LifeData } from '../../../src/domain/model';
import { TimelineFactory } from '../../../src/domain/services';
import { makeData, makeEvent, NOW } from '../../helpers/fixtures';

const factory = new TimelineFactory();

describe('TimelineFactory', () => {
  it('aplica los valores por defecto (importancia 2, rama main, público, listas vacías)', () => {
    const event = factory.create(makeData(), { now: NOW }).getEvent('a-school');
    expect(event).toMatchObject({
      importance: 2,
      branch: 'main',
      branchFrom: undefined,
      isPrivate: false,
      ongoing: false,
      skills: [],
      highlights: [],
      links: [],
      media: [],
    });
    expect(event?.start.toString()).toBe('2010');
    expect(event?.end?.toString()).toBe('2014');
  });

  it('"present" marca el evento como en curso y deja el fin a null', () => {
    const job = factory.create(makeData(), { now: NOW }).getEvent('b-job');
    expect(job?.ongoing).toBe(true);
    expect(job?.end).toBeNull();
    expect(job?.importance).toBe(3);
  });

  it('respeta rama, origen y campos opcionales', () => {
    const timeline = factory.create(makeData(), { now: NOW });
    expect(timeline.getEvent('c-side')).toMatchObject({ branch: 'side', branchFrom: 'b-job', importance: 1 });
    expect(timeline.getEvent('b-job')).toMatchObject({
      subtitle: 'Ingeniera · Acme',
      location: 'Donostia',
      organization: 'Acme',
      skills: ['TypeScript', 'three.js'],
      highlights: ['Un hito'],
    });
  });

  it('shortTitle se recorta y alimenta labelTitle; sin él, labelTitle es el título', () => {
    const data = makeData();
    data.events[0].shortTitle = '  Cole  ';
    const timeline = factory.create(data, { now: NOW });
    const first = timeline.getEvent(data.events[0].id);
    expect(first?.shortTitle).toBe('Cole');
    expect(first?.labelTitle).toBe('Cole');
    const other = timeline.getEvent(data.events[1].id);
    expect(other?.shortTitle).toBeUndefined();
    expect(other?.labelTitle).toBe(other?.title);
  });

  describe('visibilidad', () => {
    it('por defecto oculta los eventos privados', () => {
      const timeline = factory.create(makeData(), { now: NOW });
      expect(timeline.getEvent('d-secret')).toBeUndefined();
      expect(timeline.events.every((event) => !event.isPrivate)).toBe(true);
      expect(timeline.events).toHaveLength(4);
    });

    it('includePrivate: false explícito también los oculta', () => {
      expect(factory.create(makeData(), { now: NOW, includePrivate: false }).getEvent('d-secret')).toBeUndefined();
    });

    it('con includePrivate los incluye marcados como privados', () => {
      const timeline = factory.create(makeData(), { now: NOW, includePrivate: true });
      expect(timeline.events).toHaveLength(5);
      expect(timeline.getEvent('d-secret')?.isPrivate).toBe(true);
      expect(timeline.getEvent('a-school')?.isPrivate).toBe(false);
    });

    it('un evento con visibility "public" explícito siempre se incluye', () => {
      const data = makeData();
      data.events[0].visibility = 'public';
      expect(factory.create(data, { now: NOW }).getEvent('a-school')?.isPrivate).toBe(false);
    });
  });

  it('elimina categorías repetidas conservando el orden', () => {
    const data = makeData();
    data.events = [makeEvent({ id: 'dup', categories: ['play', 'work', 'play', 'work'] })];
    expect(factory.create(data, { now: NOW }).getEvent('dup')?.categoryIds).toEqual(['play', 'work']);
  });

  it('defensa en profundidad: descarta enlaces e imágenes que no son http(s) aunque no se haya validado', () => {
    const data = makeData();
    data.events = [
      makeEvent({
        id: 'x',
        links: [
          { label: 'malo', url: 'javascript:alert(1)' },
          { label: 'bueno', url: 'https://example.com/ok' },
          { label: 'data', url: 'data:text/html,<script>1</script>' },
        ],
        media: [
          { type: 'image', url: 'javascript:alert(1)', alt: 'malo' },
          { type: 'image', url: 'https://example.com/a.png', alt: 'bueno' },
        ],
      }),
    ];
    const event = factory.create(data as LifeData, { now: NOW }).getEvent('x');
    expect(event?.links).toEqual([{ label: 'bueno', url: 'https://example.com/ok' }]);
    expect(event?.media).toEqual([{ type: 'image', url: 'https://example.com/a.png', alt: 'bueno' }]);
  });

  it('inyecta "hoy" y copia meta y categorías', () => {
    const data = makeData();
    const timeline = factory.create(data, { now: new Date(Date.UTC(2021, 5, 15)) });
    expect(timeline.now.toString()).toBe('2021-06-15');
    expect(timeline.meta).toEqual(data.meta);
    expect(timeline.meta).not.toBe(data.meta);
    expect(timeline.categories[0]).not.toBe(data.categories[0]);
  });
});
