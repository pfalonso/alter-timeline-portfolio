import { describe, expect, it, vi } from 'vitest';
import { readUrlFlag, UrlFilterStateStore, type HistoryLike } from '../../../src/infrastructure/storage/UrlFilterStateStore';

/** Location + History falsos: `replaceState` actualiza el href como haría el navegador. */
function browser(href: string): { location: { href: string }; history: HistoryLike; replaceState: ReturnType<typeof vi.fn> } {
  const location = { href };
  const replaceState = vi.fn((_data: unknown, _unused: string, url?: string | URL | null) => {
    if (url !== undefined && url !== null) location.href = new URL(String(url), location.href).href;
  });
  return { location, history: { replaceState }, replaceState };
}

describe('UrlFilterStateStore.load', () => {
  it.each([
    ['sin parámetro → null (todas)', 'https://example.com/', null],
    ['otros parámetros no cuentan', 'https://example.com/?private=1', null],
    ['cat vacío → ninguna', 'https://example.com/?cat=', []],
    ['una', 'https://example.com/?cat=work', ['work']],
    ['varias', 'https://example.com/?cat=work,play', ['work', 'play']],
    ['comas codificadas', 'https://example.com/?cat=work%2Cplay', ['work', 'play']],
    ['espacios y huecos', 'https://example.com/?cat=%20work%20,,play,', ['work', 'play']],
    ['con hash y otros parámetros', 'https://example.com/app/?private=1&cat=study#x', ['study']],
  ])('%s', (_label, href, expected) => {
    const { location, history } = browser(href);
    expect(new UrlFilterStateStore(location, history).load()).toEqual(expected);
  });

  it('admite otro nombre de parámetro', () => {
    const { location, history } = browser('https://example.com/?cat=a&f=b,c');
    expect(new UrlFilterStateStore(location, history, 'f').load()).toEqual(['b', 'c']);
  });
});

describe('UrlFilterStateStore.save', () => {
  it('escribe las categorías separadas por comas legibles, con replaceState', () => {
    const { location, history, replaceState } = browser('https://example.com/');
    new UrlFilterStateStore(location, history).save(['work', 'play']);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?cat=work,play');
  });

  it('lista vacía → "cat=" (ninguna), distinto de no tener parámetro', () => {
    const { location, history, replaceState } = browser('https://example.com/?cat=work');
    new UrlFilterStateStore(location, history).save([]);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?cat=');
  });

  it('null elimina el parámetro y deja la URL limpia', () => {
    const { location, history, replaceState } = browser('https://example.com/?cat=work');
    new UrlFilterStateStore(location, history).save(null);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('conserva la ruta, el resto de parámetros y el hash', () => {
    const { location, history, replaceState } = browser('https://example.com/sub/app/?private=1&cat=a&debug=1#detalle');
    const store = new UrlFilterStateStore(location, history);
    store.save(['b', 'c']);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/sub/app/?private=1&cat=b,c&debug=1#detalle');
    store.save(null);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/sub/app/?private=1&debug=1#detalle');
  });

  it('lo guardado se vuelve a leer igual (ida y vuelta)', () => {
    const { location, history } = browser('https://example.com/?private=1');
    const store = new UrlFilterStateStore(location, history);
    for (const value of [['work', 'play'], [], ['study'], null]) {
      store.save(value);
      expect(store.load()).toEqual(value);
    }
    expect(location.href).toBe('https://example.com/?private=1');
  });

  it('funciona con window.location y window.history reales (jsdom)', () => {
    const before = window.location.href;
    const store = new UrlFilterStateStore(window.location, window.history);
    store.save(['a', 'b']);
    expect(window.location.search).toBe('?cat=a,b');
    expect(store.load()).toEqual(['a', 'b']);
    store.save(null);
    expect(window.location.href).toBe(before);
  });
});

describe('readUrlFlag', () => {
  it.each([
    ['https://example.com/?private=1', true],
    ['https://example.com/?private=true', true],
    ['https://example.com/?private', true],
    ['https://example.com/?private=', true],
    ['https://example.com/?private=0', false],
    ['https://example.com/?private=false', false],
    ['https://example.com/?other=1', false],
    ['https://example.com/', false],
    ['https://example.com/#private=1', false],
  ])('%s → %s', (href, expected) => {
    expect(readUrlFlag(href, 'private')).toBe(expected);
  });
});
