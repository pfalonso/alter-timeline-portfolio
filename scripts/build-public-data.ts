/**
 * Genera la versión PUBLICABLE de los datos: sin eventos `visibility: "private"`.
 *
 * `visibility: "private"` solo oculta eventos en la interfaz; el JSON se sirve entero y cualquiera
 * puede leerlo. Para desplegar en un servidor público hay que servir un fichero que no los contenga.
 *
 *   npm run build:public-data                       → data/life.json → data/public/life.json
 *   npm run build:public-data -- origen.json destino.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { formatIssue } from '../src/domain/errors';
import { LifeDataValidator } from '../src/domain/services/LifeDataValidator';

interface RawEvent {
  id: string;
  visibility?: string;
  branchFrom?: string;
  categories?: string[];
  [key: string]: unknown;
}
interface RawData {
  categories: { id: string }[];
  events: RawEvent[];
  [key: string]: unknown;
}

/** Devuelve una copia sin eventos privados, reenganchando las ramas que nacían de uno. */
export function toPublicData(data: RawData): RawData {
  const byId = new Map(data.events.map((event) => [event.id, event]));
  const isPrivate = (event: RawEvent | undefined): boolean => event?.visibility === 'private';

  const publicAncestor = (id: string | undefined): string | undefined => {
    const seen = new Set<string>();
    let current = id;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const event = byId.get(current);
      if (!event) return undefined;
      if (!isPrivate(event)) return current;
      current = event.branchFrom;
    }
    return undefined;
  };

  const events = data.events
    .filter((event) => !isPrivate(event))
    .map((event) => {
      const copy: RawEvent = { ...event };
      delete copy.visibility;
      delete copy.branchFrom;
      const anchor = publicAncestor(event.branchFrom);
      return anchor === undefined ? copy : { ...copy, branchFrom: anchor };
    });

  const used = new Set(events.flatMap((event) => event.categories ?? []));
  const categories = data.categories.filter((category) => used.has(category.id));
  return { ...data, categories, events };
}

function main(): number {
  const source = resolve(process.argv[2] ?? 'data/life.json');
  const target = resolve(process.argv[3] ?? 'data/public/life.json');
  let input: RawData;
  try {
    input = JSON.parse(readFileSync(source, 'utf8')) as RawData;
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const validator = new LifeDataValidator();
  const original = validator.validate(input);
  if (!original.ok) {
    console.error(`✖ ${source} no es válido; corrígelo antes (npm run validate:data).`);
    for (const issue of original.issues) console.error(`  - ${formatIssue(issue)}`);
    return 1;
  }
  const output = toPublicData(input);
  const result = validator.validate(output);
  if (!result.ok) {
    console.error('✖ El resultado público no valida:');
    for (const issue of result.issues) console.error(`  - ${formatIssue(issue)}`);
    return 1;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
  const removed = input.events.length - output.events.length;
  console.log(`✔ ${target}: ${output.events.length} eventos públicos (${removed} privados eliminados)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exit(main());
}
