/**
 * Valida un JSON de datos con el MISMO validador de dominio que usa la web.
 *   npm run validate:data                → data/life.json si existe; si no, el de ejemplo
 *   npm run validate:data -- ruta.json   → el fichero indicado
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatIssue } from '../src/domain/errors';
import { LifeDataValidator } from '../src/domain/services/LifeDataValidator';

const DEFAULTS = ['data/life.json', 'public/data/life.example.json'];

function pickFile(argument: string | undefined): string {
  if (argument) return resolve(argument);
  const found = DEFAULTS.map((file) => resolve(file)).find((file) => existsSync(file));
  if (!found) throw new Error(`No se ha encontrado ninguno de: ${DEFAULTS.join(', ')}`);
  return found;
}

function main(): number {
  let file: string;
  let input: unknown;
  try {
    file = pickFile(process.argv[2]);
    input = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const result = new LifeDataValidator().validate(input);
  if (!result.ok || !result.data) {
    console.error(`✖ ${file}: ${result.issues.length} error(es)`);
    for (const issue of result.issues) console.error(`  - ${formatIssue(issue)}`);
    return 1;
  }
  const { events, categories, meta } = result.data;
  const branches = new Set(events.map((event) => event.branch ?? meta.mainBranch ?? 'main'));
  const hidden = events.filter((event) => event.visibility === 'private').length;
  console.log(
    `✔ ${file}: válido — ${events.length} eventos (${hidden} privados), ${categories.length} categorías, ${branches.size} ramas`,
  );
  return 0;
}

process.exit(main());
