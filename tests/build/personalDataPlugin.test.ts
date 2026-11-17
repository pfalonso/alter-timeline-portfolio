import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createPersonalDataMiddleware, cvFileName, personalDataPlugin } from '../../build/personalDataPlugin';

const dir = mkdtempSync(join(tmpdir(), 'cv-'));
mkdirSync(join(dir, 'cv'));
writeFileSync(join(dir, 'cv', 'CV_Ada_ES.pdf'), '%PDF-1.4 ficticio');
writeFileSync(join(dir, 'secreto.pdf'), '%PDF-1.4 fuera');
writeFileSync(join(dir, 'life.json'), '{"ok":true}');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Respuesta falsa: guarda estado, cabeceras y cuerpo (también lo que llega por pipe). */
class FakeResponse extends Writable {
  statusCode = 0;
  readonly headers: Record<string, string> = {};
  body = '';
  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }
  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.body += chunk.toString();
    done();
  }
  override end(chunk?: unknown): this {
    if (typeof chunk === 'string') this.body += chunk;
    return super.end();
  }
}

async function request(url: string): Promise<{ res: FakeResponse; next: ReturnType<typeof vi.fn> }> {
  const middleware = createPersonalDataMiddleware({ file: join(dir, 'life.json'), route: '/data/life.json', cvDir: join(dir, 'cv'), cvRoute: '/cv/' });
  const res = new FakeResponse();
  const next = vi.fn();
  const finished = new Promise<void>((done) => res.on('finish', done));
  middleware({ url } as never, res as never, next);
  if (next.mock.calls.length === 0) await finished;
  return { res, next };
}

describe('personalDataPlugin: CV privados en /cv/', () => {
  it('cvFileName solo acepta un PDF de un segmento, sin rutas ni escapes', () => {
    expect(cvFileName('/cv/CV_Ada_ES.pdf')).toBe('CV_Ada_ES.pdf');
    expect(cvFileName('/cv/CV%20Ada.pdf')).toBeNull();
    for (const path of ['/cv/../secreto.pdf', '/cv/%2e%2e/secreto.pdf', '/cv/a/b.pdf', '/cv/..%2Fsecreto.pdf', '/cv/x.txt', '/cv/', '/cv/%E0%A4%A.pdf', '/otra/x.pdf', '/cv/.oculto.pdf']) {
      expect(cvFileName(path)).toBeNull();
    }
  });

  it('sirve el PDF con su tipo, en línea, sin caché y con nosniff', async () => {
    const { res } = await request('/cv/CV_Ada_ES.pdf?v=1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="CV_Ada_ES.pdf"');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toContain('%PDF');
  });

  it('404 si el fichero no existe o el nombre no es válido (sin path traversal)', async () => {
    for (const url of ['/cv/No_existe.pdf', '/cv/../secreto.pdf', '/cv/%2e%2e%2fsecreto.pdf', '/cv/life.json']) {
      const { res } = await request(url);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('PDF');
    }
  });

  it('sigue sirviendo /data/life.json y deja pasar el resto', async () => {
    const data = await request('/data/life.json');
    expect(data.res.statusCode).toBe(200);
    expect(data.res.body).toBe('{"ok":true}');
    const other = await request('/index.html');
    expect(other.next).toHaveBeenCalledTimes(1);
  });

  it('el plugin registra el middleware en dev y en preview, con rutas relativas a la raíz', () => {
    const plugin = personalDataPlugin({ cvDir: 'cv', file: 'life.json' });
    const use = vi.fn();
    (plugin.configResolved as (config: { root: string }) => void)({ root: dir });
    (plugin.configureServer as (server: unknown) => void)({ middlewares: { use } });
    (plugin.configurePreviewServer as (server: unknown) => void)({ middlewares: { use } });
    expect(use).toHaveBeenCalledTimes(2);
    const res = new FakeResponse();
    const next = vi.fn();
    use.mock.calls[0][0]({ url: '/nada' }, res, next);
    expect(next).toHaveBeenCalled();
  });
});
