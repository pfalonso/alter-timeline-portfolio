import { describe, expect, it } from 'vitest';
import { CategorySelection } from '../../../src/domain/model';

const IDS = ['a', 'b', 'c'];

describe('CategorySelection', () => {
  it('all / none', () => {
    const all = CategorySelection.all(IDS);
    expect([...all.activeIds]).toEqual(IDS);
    expect(all.isAll).toBe(true);
    expect(all.isNone).toBe(false);
    const none = CategorySelection.none(IDS);
    expect(none.activeIds.size).toBe(0);
    expect(none.isNone).toBe(true);
    expect(none.isAll).toBe(false);
  });

  it('of(null) equivale a todas; of([...]) descarta los ids desconocidos', () => {
    expect(CategorySelection.of(IDS, null).isAll).toBe(true);
    const some = CategorySelection.of(IDS, ['c', 'zzz', 'a']);
    expect([...some.activeIds].sort()).toEqual(['a', 'c']);
    expect(CategorySelection.of(IDS, ['zzz']).isNone).toBe(true);
    expect(CategorySelection.of(IDS, []).isNone).toBe(true);
  });

  it('toggle alterna una categoría sin mutar el original', () => {
    const all = CategorySelection.all(IDS);
    const withoutB = all.toggle('b');
    expect(withoutB.has('b')).toBe(false);
    expect(all.has('b')).toBe(true);
    expect(withoutB.toggle('b').isAll).toBe(true);
  });

  it('toggle y only ignoran ids desconocidos devolviendo la misma instancia', () => {
    const all = CategorySelection.all(IDS);
    expect(all.toggle('zzz')).toBe(all);
    expect(all.only('zzz')).toBe(all);
  });

  it('only deja solo una; selectAll y selectNone restauran', () => {
    const onlyB = CategorySelection.all(IDS).only('b');
    expect([...onlyB.activeIds]).toEqual(['b']);
    expect(onlyB.selectAll().isAll).toBe(true);
    expect(onlyB.selectNone().isNone).toBe(true);
  });

  it('toPersisted: null si están todas; si no, en orden de definición', () => {
    expect(CategorySelection.all(IDS).toPersisted()).toBeNull();
    expect(CategorySelection.none(IDS).toPersisted()).toEqual([]);
    expect(CategorySelection.of(IDS, ['c', 'a']).toPersisted()).toEqual(['a', 'c']);
  });
});
