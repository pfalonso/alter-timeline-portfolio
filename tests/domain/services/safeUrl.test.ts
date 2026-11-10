import { describe, expect, it } from 'vitest';
import { isHttpUrl } from '../../../src/domain/services';

describe('isHttpUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com/ruta?x=1#y',
    'HTTPS://EXAMPLE.COM/A',
    'https://sub.example.com:8443/a/b',
    'http://localhost:5173',
    'https://example.com/ñ/%20',
  ])('acepta %s', (url) => {
    expect(isHttpUrl(url)).toBe(true);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: con mayúsculas', 'JaVaScRiPt:alert(1)'],
    ['javascript: disfrazado de http', 'javascript://example.com/%0Aalert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://example.com/x'],
    ['mailto:', 'mailto:a@example.com'],
    ['relativa al protocolo', '//example.com'],
    ['relativa', '/ruta/local'],
    ['sin esquema', 'example.com'],
    ['esquema sin host', 'https://'],
    ['una sola barra', 'https:/example.com'],
    ['espacio delante', ' https://example.com'],
    ['espacio detrás', 'https://example.com '],
    ['salto de línea delante', '\nhttps://example.com'],
    ['tabulador + javascript', '\tjavascript:alert(1)'],
    ['vacía', ''],
  ])('rechaza %s', (_label, url) => {
    expect(isHttpUrl(url)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{ href: 'https://example.com' }], [['https://example.com']]])(
    'rechaza lo que no es texto (%j)',
    (value) => {
      expect(isHttpUrl(value)).toBe(false);
    },
  );
});
