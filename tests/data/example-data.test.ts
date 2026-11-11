import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatIssue } from '../../src/domain/errors';
import type { LifeData } from '../../src/domain/model';
import { LifeDataValidator, TimelineFactory, TimelineLayout, isHttpUrl } from '../../src/domain/services';

/** El JSON de ejemplo es lo que ve cualquiera que clone el repo: tiene que validar siempre. */
const raw: unknown = JSON.parse(readFileSync('public/data/life.example.json', 'utf8'));
const now = new Date(Date.UTC(2026, 10, 10));

describe('public/data/life.example.json', () => {
  const result = new LifeDataValidator().validate(raw);

  it('pasa el validador del dominio sin ningún error', () => {
    expect(result.issues.map(formatIssue)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.data).toBe(raw);
  });

  const data = raw as LifeData;

  it('declara schemaVersion 1 y metadatos completos', () => {
    expect(data.schemaVersion).toBe(1);
    expect(data.meta.owner.length).toBeGreaterThan(0);
    expect(data.meta.locale).toBe('es');
  });

  it('ejercita las funciones del producto: ramas, privados, eventos en curso y varias categorías', () => {
    expect(data.categories.length).toBeGreaterThanOrEqual(3);
    // Modelo de líneas vitales: todas nacen en el nacimiento, una se fusiona, otra sigue latente.
    const lines = data.branches ?? [];
    expect(data.meta.mainBranch).toBe('oficio');
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.filter((line) => line.id !== data.meta.mainBranch).every((line) => line.origin === 'nacimiento')).toBe(true);
    expect(lines.some((line) => line.mergeInto !== undefined)).toBe(true);
    expect(lines.some((line) => line.until === 'present')).toBe(true);
    expect(lines.every((line) => (line.focus ?? []).length > 0)).toBe(true);
    expect(data.events.some((event) => event.visibility === 'private')).toBe(true);
    expect(data.events.some((event) => event.date.end === 'present')).toBe(true);
    expect(data.events.some((event) => event.categories.length > 1)).toBe(true);
    const used = new Set(data.events.flatMap((event) => event.categories));
    expect(data.categories.filter((category) => !used.has(category.id))).toEqual([]);
  });

  it('todos los enlaces son http(s)', () => {
    const urls = [
      ...(data.meta.contact ?? []).map((link) => link.url),
      ...data.events.flatMap((event) => [...(event.links ?? []), ...(event.media ?? [])].map((item) => item.url)),
    ];
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !isHttpUrl(url))).toEqual([]);
  });

  it('no contiene marcado HTML en ningún texto', () => {
    expect(JSON.stringify(data)).not.toMatch(/<\s*\/?\s*[a-z][^>]*>/i);
  });

  it('se puede construir y disponer tanto en público como con privados', () => {
    const factory = new TimelineFactory();
    for (const includePrivate of [false, true]) {
      const timeline = factory.create(data, { now, includePrivate });
      const layout = new TimelineLayout().compute(timeline);
      expect(layout.nodes).toHaveLength(timeline.events.length);
      for (const node of layout.nodes) {
        expect(Number.isFinite(node.position.x + node.position.y + node.position.z)).toBe(true);
      }
    }
  });
});
