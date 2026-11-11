import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeData } from '../helpers/fixtures';

/**
 * `npm run validate:data` (scripts/validate-data.ts) de punta a punta, en un proceso aparte.
 * Siempre se le pasa una ruta explícita: estos tests nunca leen `data/life.json`.
 */
const dir = mkdtempSync(join(tmpdir(), 'validate-data-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(file: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/validate-data.ts', file], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function write(name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('scripts/validate-data.ts', () => {
  it('sale con 0 y resume el contenido cuando el JSON es válido', () => {
    const result = run('public/data/life.example.json');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/válido — 27 eventos \(1 privados\), 6 categorías, 5 ramas/);
  }, 90_000);

  it('sale con 1 y lista todos los errores con su ruta cuando no valida', () => {
    const broken = makeData() as unknown as { categories: { color: string }[]; events: { links?: unknown; date: unknown }[] };
    broken.categories[0].color = 'azul';
    broken.events[0].date = { start: '2014', end: '2010' };
    broken.events[1].links = [{ label: 'x', url: 'javascript:alert(1)' }];
    const result = run(write('broken.json', JSON.stringify(broken)));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('3 error(es)');
    expect(result.stderr).toContain('categories[0].color: "azul" debe ser un color hex #RRGGBB');
    expect(result.stderr).toContain('events[0].date.end:');
    expect(result.stderr).toContain('events[1].links[0].url:');
  }, 90_000);

  it('sale con 2 si el fichero no existe o no es JSON', () => {
    expect(run(join(dir, 'no-existe.json')).status).toBe(2);
    const notJson = run(write('roto.json', '{ "schemaVersion": 1, '));
    expect(notJson.status).toBe(2);
    expect(notJson.stderr).toContain('✖');
  }, 90_000);
});
