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
import { validateLineLife } from '../src/domain/services/LineLifeRules';

interface RawEvent {
  id: string;
  visibility?: string;
  branchFrom?: string;
  categories?: string[];
  ledTo?: string[];
  alsoBranches?: string[];
  [key: string]: unknown;
}
interface RawLine {
  id: string;
  origin?: string;
  mergeInto?: { branch: string; event: string };
  ghost?: boolean;
  pauses?: { from: string; to: string }[];
  [key: string]: unknown;
}
interface RawData {
  meta?: { mainBranch?: string; [key: string]: unknown };
  categories: { id: string }[];
  events: RawEvent[];
  branches?: RawLine[];
  story?: { title?: string; path: string[]; [key: string]: unknown };
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
      // Los enlaces causales a eventos privados desaparecen (sin dejar la lista vacía).
      if (event.ledTo) {
        const ledTo = event.ledTo.filter((id) => byId.has(id) && !isPrivate(byId.get(id)));
        if (ledTo.length > 0) copy.ledTo = ledTo;
        else delete copy.ledTo;
      }
      const anchor = publicAncestor(event.branchFrom);
      return anchor === undefined ? copy : { ...copy, branchFrom: anchor };
    });

  const used = new Set(events.flatMap((event) => event.categories ?? []));
  const categories = data.categories.filter((category) => used.has(category.id));
  const result: RawData = { ...data, categories, events };
  if (data.branches) result.branches = publicLines(data.branches, events, byId, publicAncestor, data.meta?.mainBranch ?? 'main');
  cleanUnions(result);
  // El recorrido de la historia pierde los pasos privados; los arcos (capítulos) se conservan.
  if (data.story) result.story = { ...data.story, path: data.story.path.filter((id) => byId.has(id) && !isPrivate(byId.get(id))) };
  return result;
}

/**
 * Líneas sin rastro de eventos privados: desaparecen las que se quedan sin eventos públicos; un
 * `origin` privado se reengancha al ancestro público (o se quita) y una fusión en un evento privado
 * se quita (la línea se disuelve en vez de converger).
 */
/**
 * Nodos de unión coherentes tras quitar lo privado: fuera las líneas que ya no existen y las que,
 * sin sus eventos privados, ya no están vivas en esa fecha (p. ej. han «terminado» antes).
 */
function cleanUnions(result: RawData): void {
  const mainBranch = result.meta?.mainBranch ?? 'main';
  const lines = new Set([mainBranch, ...result.events.map((event) => event.branch ?? mainBranch), ...(result.branches ?? []).filter((line) => !line.ghost).map((line) => line.id)]);
  for (const event of result.events) {
    if (!event.alsoBranches) continue;
    event.alsoBranches = event.alsoBranches.filter((id) => lines.has(id) && id !== (event.branch ?? mainBranch));
  }
  // Las líneas que dejan de estar vivas en un nodo de unión salen de él (en orden inverso para no
  // desplazar los índices).
  const dead: { event: number; item: number }[] = [];
  validateLineLife(result as unknown as Record<string, unknown>, mainBranch, (path) => {
    const match = /^events\[(\d+)\]\.alsoBranches\[(\d+)\]$/.exec(path);
    if (match) dead.push({ event: Number(match[1]), item: Number(match[2]) });
  });
  for (const { event, item } of dead.reverse()) result.events[event].alsoBranches?.splice(item, 1);
  for (const event of result.events) if (event.alsoBranches?.length === 0) delete event.alsoBranches;
}

function publicLines(
  lines: RawLine[],
  events: RawEvent[],
  byId: Map<string, RawEvent>,
  publicAncestor: (id: string | undefined) => string | undefined,
  mainBranch: string,
): RawLine[] {
  const alive = new Set(events.map((event) => (typeof event.branch === 'string' ? event.branch : mainBranch)));
  alive.add(mainBranch);
  // Una línea que solo pasa por nodos de unión públicos también sigue existiendo.
  for (const event of events) for (const id of event.alsoBranches ?? []) alive.add(id);
  const isPublic = (id: string): boolean => byId.has(id) && byId.get(id)?.visibility !== 'private';
  return lines
    .filter((line) => (line.ghost ? publicAncestor(line.origin) !== undefined : alive.has(line.id)))
    .map((line) => {
      const copy: RawLine = { ...line };
      // Una pausa que empezaba o terminaba en un evento privado se quita (la línea sigue sin cortes).
      if (line.pauses) {
        const pauses = line.pauses.filter((pause) => isPublic(pause.from) && isPublic(pause.to));
        if (pauses.length > 0) copy.pauses = pauses;
        else delete copy.pauses;
      }
      if (line.origin !== undefined) {
        const anchor = publicAncestor(line.origin);
        const anchorBranch = anchor === undefined ? undefined : (byId.get(anchor)?.branch ?? mainBranch);
        if (anchor === undefined || anchorBranch === line.id) delete copy.origin;
        else copy.origin = anchor;
      }
      const merge = line.mergeInto;
      if (merge && (byId.get(merge.event)?.visibility === 'private' || !alive.has(merge.branch))) delete copy.mergeInto;
      return copy;
    });
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
