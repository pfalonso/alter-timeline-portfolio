import { afterEach, describe, expect, it } from 'vitest';
import { append, clear, el, focusableWithin, safeLink } from '../../../src/infrastructure/dom/dom';
import { STRINGS } from '../../../src/infrastructure/dom/strings';
import { cleanupDom } from '../../helpers/dom';

afterEach(cleanupDom);

describe('el()', () => {
  it('crea el elemento con clase, texto, atributos e hijos', () => {
    const child = el('span', { text: 'hijo' });
    const node = el('button', { class: 'a b', text: 'Hola', attrs: { type: 'button', 'data-x': 3, 'aria-pressed': true } }, [child]);
    expect(node.tagName).toBe('BUTTON');
    expect(node.className).toBe('a b');
    expect(node.getAttribute('type')).toBe('button');
    expect(node.getAttribute('data-x')).toBe('3');
    expect(node.getAttribute('aria-pressed')).toBe('');
    expect(node.lastElementChild).toBe(child);
    expect(node.textContent).toBe('Holahijo');
  });

  it('omite atributos undefined o false e hijos nulos', () => {
    const node = el('div', { attrs: { title: undefined, hidden: false } }, [null, undefined, el('i')]);
    expect(node.hasAttribute('title')).toBe(false);
    expect(node.hasAttribute('hidden')).toBe(false);
    expect(node.childNodes).toHaveLength(1);
    expect(el('p').outerHTML).toBe('<p></p>');
  });

  it('el texto vacío es texto, no ausencia', () => {
    expect(el('p', { text: '' }).textContent).toBe('');
  });

  it('el texto nunca se interpreta como HTML', () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const node = el('p', { text: payload });
    expect(node.textContent).toBe(payload);
    expect(node.children).toHaveLength(0);
    expect(node.innerHTML).toBe('&lt;img src=x onerror="alert(1)"&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('los atributos tampoco pueden romper el marcado', () => {
    const node = el('p', { attrs: { title: '"><img src=x onerror=alert(1)>' } });
    document.body.append(node);
    expect(node.getAttribute('title')).toBe('"><img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('append() y clear()', () => {
  it('append ignora los huecos y conserva el orden', () => {
    const parent = el('div');
    append(parent, el('a'), null, el('b'), undefined, el('i'));
    expect([...parent.children].map((child) => child.tagName)).toEqual(['A', 'B', 'I']);
  });

  it('clear vacía el nodo', () => {
    const parent = el('div', { text: 'x' }, [el('a')]);
    clear(parent);
    expect(parent.childNodes).toHaveLength(0);
  });
});

describe('safeLink()', () => {
  it('crea un enlace externo seguro: nueva pestaña, sin opener ni referrer', () => {
    const link = safeLink('Web', 'https://example.com/a?b=1', 'mi-clase');
    expect(link).toBeInstanceOf(HTMLAnchorElement);
    expect(link?.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(link?.target).toBe('_blank');
    expect(link?.rel.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
    expect(link?.textContent).toBe('Web');
    expect(link?.className).toBe('mi-clase');
  });

  it('acepta http', () => {
    expect(safeLink('x', 'http://example.com')?.protocol).toBe('http:');
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
    '//example.com',
    '/relativa',
    '',
  ])('devuelve null para %j', (url) => {
    expect(safeLink('x', url)).toBeNull();
  });

  it('la etiqueta se escribe como texto', () => {
    const link = safeLink('<b>negrita</b>', 'https://example.com');
    expect(link?.children).toHaveLength(0);
    expect(link?.textContent).toBe('<b>negrita</b>');
  });
});

describe('focusableWithin()', () => {
  it('devuelve enlaces con href, botones activos y tabindex ≥ 0, en orden de documento', () => {
    const root = el('div', {}, [
      el('button', { text: '1', attrs: { id: 'b1' } }),
      el('button', { text: 'x', attrs: { disabled: true } }),
      el('a', { text: 'sin href' }),
      el('a', { text: '2', attrs: { href: 'https://example.com', id: 'a1' } }),
      el('div', { attrs: { tabindex: 0, id: 'd1' } }),
      el('div', { attrs: { tabindex: -1 } }),
      el('button', { text: 'oculto', attrs: { hidden: true } }),
      el('span', { text: 'no' }),
    ]);
    expect(focusableWithin(root).map((node) => node.id)).toEqual(['b1', 'a1', 'd1']);
  });

  it('lista vacía si no hay nada enfocable', () => {
    expect(focusableWithin(el('div', {}, [el('p', { text: 'x' })]))).toEqual([]);
  });
});

describe('STRINGS', () => {
  it('formatea el contador y el origen de una rama', () => {
    expect(STRINGS.eventsVisible(3, 12)).toBe('3 / 12 eventos');
    expect(STRINGS.branchFrom('Un semestre')).toBe('Rama que nace de «Un semestre»');
  });
});
