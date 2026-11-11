import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LifeDataValidator } from '../../src/domain/services';
import { makeData } from '../helpers/fixtures';

/**
 * El proyecto no incluye un validador de JSON Schema (no hay `ajv`), así que no se puede validar
 * el documento contra `schema/life.schema.json`. Lo que sí se comprueba es que el schema y el
 * validador del dominio no se contradicen en lo que ambos pueden expresar: campos obligatorios,
 * enumeraciones y patrones.
 */
interface SchemaNode {
  $ref?: string;
  type?: string;
  pattern?: string;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  enum?: unknown[];
  const?: unknown;
  minItems?: number;
  anyOf?: SchemaNode[];
}

const schema = JSON.parse(readFileSync('schema/life.schema.json', 'utf8')) as SchemaNode & {
  $schema: string;
  $defs: Record<string, SchemaNode>;
};
const defs = schema.$defs;
const validator = new LifeDataValidator();
type Loose = { meta: Record<string, unknown>; categories: Record<string, unknown>[]; events: Record<string, unknown>[] };

function domainAccepts(mutate: (data: Loose) => void): boolean {
  const data = makeData() as unknown as Loose;
  mutate(data);
  return validator.validate(data).ok;
}

describe('schema/life.schema.json ↔ validador del dominio', () => {
  it('es JSON Schema draft 2020-12 y describe un LifeData con schemaVersion 1', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['schemaVersion', 'meta', 'categories', 'events']);
    expect(schema.properties?.schemaVersion.const).toBe(1);
  });

  it('todas las referencias internas ($ref) existen', () => {
    const refs = [...JSON.stringify(schema).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)].map((match) => match[1]);
    expect(refs.length).toBeGreaterThan(10);
    expect(refs.filter((name) => !(name in defs))).toEqual([]);
  });

  it('cada campo que el schema marca como obligatorio lo exige también el dominio', () => {
    for (const key of schema.properties?.meta.required ?? []) expect(domainAccepts((data) => delete data.meta[key])).toBe(false);
    for (const key of defs.category.required ?? []) expect(domainAccepts((data) => delete data.categories[0][key])).toBe(false);
    for (const key of defs.event.required ?? []) expect(domainAccepts((data) => delete data.events[0][key])).toBe(false);
    for (const key of defs.link.required ?? []) {
      expect(domainAccepts((data) => {
        const link: Record<string, unknown> = { label: 'x', url: 'https://example.com' };
        delete link[key];
        data.events[0].links = [link];
      })).toBe(false);
    }
    const media = defs.event.properties?.media.items;
    for (const key of media?.required ?? []) {
      expect(domainAccepts((data) => {
        const item: Record<string, unknown> = { type: 'image', url: 'https://example.com/a.png', alt: 'x' };
        delete item[key];
        data.events[0].media = [item];
      })).toBe(false);
    }
  });

  it('los campos del schema coinciden con los del contrato', () => {
    expect(Object.keys(defs.event.properties ?? {}).sort()).toEqual(
      [
        'branch', 'branchFrom', 'categories', 'date', 'description', 'highlights', 'id', 'importance', 'links', 'location',
        'media', 'organization', 'shortTitle', 'skills', 'subtitle', 'summary', 'title', 'visibility',
      ].sort(),
    );
    expect(Object.keys(defs.category.properties ?? {}).sort()).toEqual(['color', 'description', 'icon', 'id', 'label']);
    expect(Object.keys(schema.properties?.meta.properties ?? {}).sort()).toEqual([
      'contact', 'locale', 'mainBranch', 'owner', 'tagline', 'title',
    ]);
    expect(Object.keys(defs.branch.properties ?? {}).sort()).toEqual(
      ['color', 'description', 'focus', 'id', 'label', 'mergeInto', 'origin', 'until'].sort(),
    );
    expect(Object.keys(defs.focusPeriod.properties ?? {}).sort()).toEqual(['end', 'level', 'start']);
  });

  it('líneas vitales: lo obligatorio y las enumeraciones del schema son lo que exige el dominio', () => {
    const line = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'side', label: 'Paralela', ...extra });
    expect(domainAccepts((data) => ((data as unknown as { branches: unknown[] }).branches = [line()]))).toBe(true);
    for (const key of defs.branch.required ?? []) {
      expect(domainAccepts((data) => {
        const item = line();
        delete item[key];
        (data as unknown as { branches: unknown[] }).branches = [item];
      })).toBe(false);
    }
    expect(defs.branch.properties?.until.const).toBe('present');
    expect(domainAccepts((data) => ((data as unknown as { branches: unknown[] }).branches = [line({ until: 'siempre' })]))).toBe(false);
    expect(defs.focusPeriod.properties?.level.enum).toEqual([1, 2, 3]);
    for (const level of [1, 2, 3]) {
      expect(domainAccepts((data) => ((data as unknown as { branches: unknown[] }).branches = [line({ focus: [{ start: '2016', level }] })]))).toBe(true);
    }
    expect(domainAccepts((data) => ((data as unknown as { branches: unknown[] }).branches = [line({ focus: [{ start: '2016', level: 4 }] })]))).toBe(false);
    expect(defs.focusPeriod.required).toEqual(['start']);
    expect(domainAccepts((data) => ((data as unknown as { branches: unknown[] }).branches = [line({ focus: [{ end: '2016' }] })]))).toBe(false);
  });

  it('las enumeraciones coinciden', () => {
    const event = defs.event.properties ?? {};
    expect(event.importance.enum).toEqual([1, 2, 3]);
    expect(event.visibility.enum).toEqual(['public', 'private']);
    for (const value of event.importance.enum ?? []) expect(domainAccepts((data) => (data.events[0].importance = value))).toBe(true);
    for (const value of event.visibility.enum ?? []) expect(domainAccepts((data) => (data.events[0].visibility = value))).toBe(true);
    expect(domainAccepts((data) => (data.events[0].importance = 4))).toBe(false);
    expect(event.date.properties?.end.anyOf?.some((option) => option.const === 'present')).toBe(true);
    expect(schema.properties?.categories.minItems).toBe(1);
    expect(event.categories.minItems).toBe(1);
  });

  const matches = (node: SchemaNode, value: string): boolean => new RegExp(node.pattern ?? '', 'u').test(value);

  it.each(['a', 'a-b', 'a1-b2', 'abc', 'A', 'a_b', '-a', 'a-', 'a--b', 'a b', '', 'á'])('ids: %j — mismo veredicto', (id) => {
    expect(matches(defs.kebabId, id)).toBe(domainAccepts((data) => data.categories.push({ id, label: 'X', color: '#000000' })));
  });

  it.each(['#000000', '#FFB454', '#abcdef', '#fff', 'red', '#GGGGGG', '#1234567', '000000', ''])(
    'colores: %j — mismo veredicto',
    (color) => {
      expect(matches(defs.category.properties?.color ?? {}, color)).toBe(domainAccepts((data) => (data.categories[0].color = color)));
    },
  );

  it.each(['2019', '2019-03', '2019-03-14', '2019-13', '2019-00', '2019-03-32', '19', '2019-3', 'present', '2019/03', ''])(
    'fechas: %j — mismo veredicto',
    (start) => {
      expect(matches(defs.partialDate, start)).toBe(domainAccepts((data) => (data.events[0].date = { start })));
    },
  );

  it('el dominio es más estricto que el patrón de fecha: días imposibles y años < 1000', () => {
    for (const start of ['2019-02-30', '2019-04-31', '0999']) {
      expect(matches(defs.partialDate, start)).toBe(true);
      expect(domainAccepts((data) => (data.events[0].date = { start }))).toBe(false);
    }
  });

  it.each([
    'https://example.com',
    'http://example.com/a?b=1',
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://example.com',
    '//example.com',
    'HTTPS://EXAMPLE.COM',
    'Http://example.com',
    '/relativa',
    ' https://example.com',
    'https://example.com con espacios',
    '',
  ])('URLs: %j — mismo veredicto', (url) => {
    expect(matches(defs.httpUrl, url)).toBe(domainAccepts((data) => (data.events[0].links = [{ label: 'x', url }])));
  });
});
