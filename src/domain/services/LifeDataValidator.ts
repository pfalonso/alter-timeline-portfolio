import type { ValidationIssue } from '../errors/ValidationError';
import { ValidationError } from '../errors/ValidationError';
import type { LifeData } from '../model/LifeData';
import { MAIN_BRANCH } from '../model/LifeEvent';
import { PartialDate } from '../model/PartialDate';
import { isHttpUrl } from './safeUrl';

/** Longitud máxima del título corto que se usa en los rótulos de la escena. */
export const SHORT_TITLE_MAX = 40;

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
  /** Solo presente si `ok`. */
  readonly data?: LifeData;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const PRESENT = 'present';

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Acumula errores con su ruta; nunca lanza. */
class IssueCollector {
  readonly issues: ValidationIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  requiredString(obj: Rec, key: string, path: string): string | null {
    const value = obj[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      this.add(`${path}.${key}`, 'es obligatorio y debe ser un texto no vacío');
      return null;
    }
    return value;
  }

  optionalString(obj: Rec, key: string, path: string): void {
    const value = obj[key];
    if (value !== undefined && typeof value !== 'string') this.add(`${path}.${key}`, 'debe ser un texto');
  }

  optionalStringArray(obj: Rec, key: string, path: string): void {
    const value = obj[key];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      this.add(`${path}.${key}`, 'debe ser una lista de textos');
      return;
    }
    value.forEach((item, index) => {
      if (typeof item !== 'string' || item.trim().length === 0) {
        this.add(`${path}.${key}[${index}]`, 'debe ser un texto no vacío');
      }
    });
  }

  kebabId(obj: Rec, path: string, seen: Set<string>): string | null {
    const id = this.requiredString(obj, 'id', path);
    if (id === null) return null;
    if (!KEBAB.test(id)) this.add(`${path}.id`, `"${id}" debe estar en kebab-case (a-z, 0-9 y guiones)`);
    if (seen.has(id)) this.add(`${path}.id`, `id duplicado "${id}"`);
    seen.add(id);
    return id;
  }

  links(value: unknown, path: string): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      this.add(path, 'debe ser una lista de enlaces { label, url }');
      return;
    }
    value.forEach((link, index) => {
      const linkPath = `${path}[${index}]`;
      if (!isRecord(link)) {
        this.add(linkPath, 'debe ser un objeto { label, url }');
        return;
      }
      this.requiredString(link, 'label', linkPath);
      this.httpUrl(link, linkPath);
    });
  }

  httpUrl(obj: Rec, path: string): void {
    const url = this.requiredString(obj, 'url', path);
    if (url !== null && !isHttpUrl(url)) this.add(`${path}.url`, `"${url}" debe ser una URL http(s) absoluta`);
  }
}

/**
 * Valida un documento `LifeData` (schemaVersion 1) acumulando TODOS los errores con su ruta.
 * Servicio de dominio puro: no toca red ni DOM.
 */
export class LifeDataValidator {
  validate(input: unknown): ValidationResult {
    const collector = new IssueCollector();
    if (!isRecord(input)) {
      collector.add('', 'el documento debe ser un objeto JSON');
      return { ok: false, issues: collector.issues };
    }
    if (input.schemaVersion !== 1) collector.add('schemaVersion', 'debe ser 1');

    const mainBranch = this.validateMeta(input.meta, collector);
    const categoryIds = this.validateCategories(input.categories, collector);
    const graph = this.validateEvents(input.events, categoryIds, mainBranch, collector);
    this.validateLines(input.branches, graph, mainBranch, collector);
    this.checkMainBranch(input, graph, mainBranch, collector);
    this.checkOriginCycles(graph, mainBranch, collector);

    const ok = collector.issues.length === 0;
    return ok ? { ok, issues: [], data: input as unknown as LifeData } : { ok, issues: collector.issues };
  }

  /** Devuelve los datos tipados o lanza `ValidationError` con todos los errores. */
  assertValid(input: unknown): LifeData {
    const result = this.validate(input);
    if (!result.ok || !result.data) throw new ValidationError(result.issues);
    return result.data;
  }

  /** Devuelve la línea central (`meta.mainBranch` o "main"). */
  private validateMeta(meta: unknown, c: IssueCollector): string {
    if (!isRecord(meta)) {
      c.add('meta', 'es obligatorio y debe ser un objeto');
      return MAIN_BRANCH;
    }
    c.requiredString(meta, 'owner', 'meta');
    c.requiredString(meta, 'title', 'meta');
    c.requiredString(meta, 'locale', 'meta');
    c.optionalString(meta, 'tagline', 'meta');
    c.links(meta.contact, 'meta.contact');
    if (meta.mainBranch === undefined) return MAIN_BRANCH;
    if (typeof meta.mainBranch !== 'string' || !KEBAB.test(meta.mainBranch)) {
      c.add('meta.mainBranch', 'debe ser un id de rama en kebab-case');
      return MAIN_BRANCH;
    }
    return meta.mainBranch;
  }

  private validateCategories(categories: unknown, c: IssueCollector): Set<string> {
    const ids = new Set<string>();
    if (!Array.isArray(categories) || categories.length === 0) {
      c.add('categories', 'debe ser una lista con al menos una categoría');
      return ids;
    }
    categories.forEach((category, index) => {
      const path = `categories[${index}]`;
      if (!isRecord(category)) {
        c.add(path, 'debe ser un objeto');
        return;
      }
      c.kebabId(category, path, ids);
      c.requiredString(category, 'label', path);
      const color = c.requiredString(category, 'color', path);
      if (color !== null && !HEX_COLOR.test(color)) {
        c.add(`${path}.color`, `"${color}" debe ser un color hex #RRGGBB`);
      }
      c.optionalString(category, 'icon', path);
      c.optionalString(category, 'description', path);
    });
    return ids;
  }

  private validateEvents(
    events: unknown,
    categoryIds: ReadonlySet<string>,
    mainBranch: string,
    c: IssueCollector,
  ): BranchGraph {
    const empty: BranchGraph = { eventIds: new Set(), branchOfEvent: new Map(), parentBranch: new Map(), usedBranches: new Set() };
    if (!Array.isArray(events)) {
      c.add('events', 'debe ser una lista de eventos');
      return empty;
    }
    const ids = new Set<string>();
    const valid: { index: number; event: Rec }[] = [];
    events.forEach((event, index) => {
      const path = `events[${index}]`;
      if (!isRecord(event)) {
        c.add(path, 'debe ser un objeto');
        return;
      }
      valid.push({ index, event });
      c.kebabId(event, path, ids);
      c.requiredString(event, 'title', path);
      c.requiredString(event, 'summary', path);
      if (event.shortTitle !== undefined) {
        const short = event.shortTitle;
        if (typeof short !== 'string' || short.trim().length === 0) {
          c.add(`${path}.shortTitle`, 'si se indica, debe ser un texto no vacío');
        } else if (short.trim().length > SHORT_TITLE_MAX) {
          c.add(`${path}.shortTitle`, `debe tener como máximo ${SHORT_TITLE_MAX} caracteres`);
        }
      }
      for (const key of ['subtitle', 'description', 'location', 'organization']) {
        c.optionalString(event, key, path);
      }
      c.optionalStringArray(event, 'skills', path);
      c.optionalStringArray(event, 'highlights', path);
      c.links(event.links, `${path}.links`);
      this.validateDate(event.date, `${path}.date`, c);
      this.validateEventCategories(event.categories, categoryIds, `${path}.categories`, c);
      this.validateMedia(event.media, `${path}.media`, c);

      if (event.importance !== undefined && ![1, 2, 3].includes(event.importance as number)) {
        c.add(`${path}.importance`, 'debe ser 1, 2 o 3');
      }
      if (event.visibility !== undefined && event.visibility !== 'public' && event.visibility !== 'private') {
        c.add(`${path}.visibility`, 'debe ser "public" o "private"');
      }
      if (event.branch !== undefined && (typeof event.branch !== 'string' || !KEBAB.test(event.branch))) {
        c.add(`${path}.branch`, 'debe ser un id de rama en kebab-case');
      }
      if (event.branchFrom !== undefined && typeof event.branchFrom !== 'string') {
        c.add(`${path}.branchFrom`, 'debe ser el id de un evento');
      }
    });
    return this.validateBranches(valid, ids, mainBranch, c);
  }

  private validateDate(date: unknown, path: string, c: IssueCollector): void {
    if (!isRecord(date)) {
      c.add(path, 'es obligatorio y debe ser un objeto { start, end? }');
      return;
    }
    const start = PartialDate.tryParse(date.start);
    if (!start) c.add(`${path}.start`, `"${String(date.start)}" no es una fecha válida (YYYY, YYYY-MM o YYYY-MM-DD)`);
    if (date.end === undefined || date.end === PRESENT) return;
    const end = PartialDate.tryParse(date.end);
    if (!end) {
      c.add(`${path}.end`, `"${String(date.end)}" no es una fecha válida (YYYY, YYYY-MM, YYYY-MM-DD o "present")`);
      return;
    }
    if (start && end.isDefinitelyBefore(start)) {
      c.add(`${path}.end`, `"${end.toString()}" es anterior a start "${start.toString()}"`);
    }
  }

  private validateEventCategories(
    categories: unknown,
    known: ReadonlySet<string>,
    path: string,
    c: IssueCollector,
  ): void {
    if (!Array.isArray(categories) || categories.length === 0) {
      c.add(path, 'debe incluir al menos un id de categoría');
      return;
    }
    categories.forEach((id, index) => {
      if (typeof id !== 'string') c.add(`${path}[${index}]`, 'debe ser un id de categoría');
      else if (!known.has(id)) c.add(`${path}[${index}]`, `la categoría "${id}" no existe`);
    });
  }

  private validateMedia(media: unknown, path: string, c: IssueCollector): void {
    if (media === undefined) return;
    if (!Array.isArray(media)) {
      c.add(path, 'debe ser una lista');
      return;
    }
    media.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isRecord(item)) {
        c.add(itemPath, 'debe ser un objeto { type, url, alt }');
        return;
      }
      if (item.type !== 'image') c.add(`${itemPath}.type`, 'solo se admite "image"');
      c.httpUrl(item, itemPath);
      if (typeof item.alt !== 'string') c.add(`${itemPath}.alt`, 'es obligatorio (texto alternativo)');
    });
  }

  /**
   * `branchFrom` existe, no apunta a la propia rama, es único por rama. Devuelve el grafo de ramas
   * (la comprobación de ciclos se hace después, cuando `branches[].origin` puede haberlo cambiado).
   */
  private validateBranches(
    events: { index: number; event: Rec }[],
    ids: ReadonlySet<string>,
    mainBranch: string,
    c: IssueCollector,
  ): BranchGraph {
    const branchOfEvent = new Map<string, string>();
    for (const { event } of events) {
      if (typeof event.id === 'string') {
        branchOfEvent.set(event.id, typeof event.branch === 'string' ? event.branch : mainBranch);
      }
    }
    const parentBranch = new Map<string, string>();
    const originOfBranch = new Map<string, string>();
    for (const { index, event } of events) {
      const from = event.branchFrom;
      if (typeof from !== 'string') continue;
      const path = `events[${index}].branchFrom`;
      const branch = typeof event.branch === 'string' ? event.branch : mainBranch;
      if (!ids.has(from)) {
        c.add(path, `el evento "${from}" no existe`);
        continue;
      }
      if (from === event.id) {
        c.add(path, 'un evento no puede bifurcarse de sí mismo');
        continue;
      }
      if (branch === mainBranch) {
        c.add(path, `la rama "${mainBranch}" es el tronco y no puede tener branchFrom`);
        continue;
      }
      if (branchOfEvent.get(from) === branch) {
        c.add(path, `"${from}" pertenece a la misma rama "${branch}"; debe ser un evento de otra rama`);
        continue;
      }
      const previous = originOfBranch.get(branch);
      if (previous !== undefined && previous !== from) {
        c.add(path, `la rama "${branch}" ya nace de "${previous}"; no puede nacer también de "${from}"`);
        continue;
      }
      originOfBranch.set(branch, from);
      parentBranch.set(branch, branchOfEvent.get(from) ?? mainBranch);
    }
    return { eventIds: ids, branchOfEvent, parentBranch, usedBranches: new Set(branchOfEvent.values()) };
  }

  /** `branches[]`: líneas vitales con nombre, origen, fusión, `until` y periodos de foco. */
  private validateLines(lines: unknown, graph: BranchGraph, mainBranch: string, c: IssueCollector): void {
    if (lines === undefined) return;
    if (!Array.isArray(lines)) {
      c.add('branches', 'debe ser una lista de líneas { id, label, … }');
      return;
    }
    const known = new Set([...graph.usedBranches, mainBranch]);
    const seen = new Set<string>();
    const mergeTarget = new Map<string, string>();
    lines.forEach((line, index) => {
      const path = `branches[${index}]`;
      if (!isRecord(line)) {
        c.add(path, 'debe ser un objeto { id, label, … }');
        return;
      }
      const id = c.kebabId(line, path, seen);
      c.requiredString(line, 'label', path);
      c.optionalString(line, 'description', path);
      if (line.color !== undefined && (typeof line.color !== 'string' || !HEX_COLOR.test(line.color))) {
        c.add(`${path}.color`, `"${String(line.color)}" debe ser un color hex #RRGGBB`);
      }
      if (id !== null && !known.has(id)) {
        c.add(`${path}.id`, `ningún evento usa la rama "${id}" (y no es meta.mainBranch "${mainBranch}")`);
      }
      const isMain = id === mainBranch;
      if (line.origin !== undefined) {
        if (typeof line.origin !== 'string' || !graph.eventIds.has(line.origin)) {
          c.add(`${path}.origin`, `el evento "${String(line.origin)}" no existe`);
        } else if (isMain) {
          c.add(`${path}.origin`, `"${mainBranch}" es la línea central y no nace de otra`);
        } else if (graph.branchOfEvent.get(line.origin) === id) {
          c.add(`${path}.origin`, `"${line.origin}" pertenece a la propia línea "${id}"; debe ser un evento de otra`);
        } else if (id !== null) {
          graph.parentBranch.set(id, graph.branchOfEvent.get(line.origin) ?? mainBranch);
        }
      }
      if (line.mergeInto !== undefined) {
        const target = this.validateMerge(line.mergeInto, `${path}.mergeInto`, id, isMain, known, graph, c);
        if (target !== null && id !== null) mergeTarget.set(id, target);
      }
      if (line.until !== undefined) {
        if (line.until !== PRESENT) c.add(`${path}.until`, 'solo admite "present"');
        else if (line.mergeInto !== undefined) {
          c.add(`${path}.until`, 'una línea que se fusiona (mergeInto) termina en la fusión: no admite until');
        }
      }
      this.validateFocus(line.focus, `${path}.focus`, c);
    });
    this.checkMergeCycles(mergeTarget, c);
  }

  private validateMerge(
    merge: unknown,
    path: string,
    id: string | null,
    isMain: boolean,
    known: ReadonlySet<string>,
    graph: BranchGraph,
    c: IssueCollector,
  ): string | null {
    if (!isRecord(merge)) {
      c.add(path, 'debe ser un objeto { branch, event }');
      return null;
    }
    if (isMain) {
      c.add(path, 'la línea central no puede fusionarse en otra');
      return null;
    }
    const branch = c.requiredString(merge, 'branch', path);
    const event = c.requiredString(merge, 'event', path);
    let ok = true;
    if (branch !== null && !known.has(branch)) {
      c.add(`${path}.branch`, `la línea "${branch}" no existe`);
      ok = false;
    } else if (branch !== null && branch === id) {
      c.add(`${path}.branch`, 'una línea no puede fusionarse consigo misma');
      ok = false;
    }
    if (event !== null && !graph.eventIds.has(event)) {
      c.add(`${path}.event`, `el evento "${event}" no existe`);
      ok = false;
    } else if (event !== null && branch !== null && graph.branchOfEvent.get(event) !== branch) {
      c.add(`${path}.event`, `"${event}" no pertenece a la línea "${branch}"`);
      ok = false;
    }
    return ok ? branch : null;
  }

  private validateFocus(focus: unknown, path: string, c: IssueCollector): void {
    if (focus === undefined) return;
    if (!Array.isArray(focus)) {
      c.add(path, 'debe ser una lista de periodos { start, end?, level? }');
      return;
    }
    focus.forEach((period, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isRecord(period)) {
        c.add(itemPath, 'debe ser un objeto { start, end?, level? }');
        return;
      }
      this.validateDate(period, itemPath, c);
      if (period.level !== undefined && ![1, 2, 3].includes(period.level as number)) {
        c.add(`${itemPath}.level`, 'debe ser 1, 2 o 3');
      }
    });
  }

  private checkMergeCycles(mergeTarget: ReadonlyMap<string, string>, c: IssueCollector): void {
    for (const start of mergeTarget.keys()) {
      const visited = [start];
      let current = mergeTarget.get(start);
      while (current !== undefined) {
        if (current === start) {
          c.add('branches', `las fusiones forman un ciclo (${[...visited, current].join(' → ')})`);
          return;
        }
        if (visited.includes(current)) break;
        visited.push(current);
        current = mergeTarget.get(current);
      }
    }
  }

  /** Con `meta.mainBranch` explícito, o con líneas declaradas, la línea central debe tener eventos. */
  private checkMainBranch(input: Rec, graph: BranchGraph, mainBranch: string, c: IssueCollector): void {
    if (graph.usedBranches.size === 0 || graph.usedBranches.has(mainBranch)) return;
    const explicit = isRecord(input.meta) && input.meta.mainBranch !== undefined;
    if (explicit) c.add('meta.mainBranch', `ningún evento pertenece a la línea central "${mainBranch}"`);
    else if (Array.isArray(input.branches)) {
      c.add('meta.mainBranch', `falta: ningún evento pertenece a "${MAIN_BRANCH}"; indica cuál es la línea central`);
    }
  }

  private checkOriginCycles(graph: BranchGraph, mainBranch: string, c: IssueCollector): void {
    for (const branch of graph.parentBranch.keys()) {
      const visited = new Set<string>([branch]);
      let current = graph.parentBranch.get(branch);
      while (current !== undefined && current !== mainBranch) {
        if (visited.has(current)) {
          c.add('events', `las ramas forman un ciclo de bifurcaciones (${[...visited].join(' → ')} → ${current})`);
          return;
        }
        visited.add(current);
        current = graph.parentBranch.get(current);
      }
    }
  }
}

interface BranchGraph {
  readonly eventIds: ReadonlySet<string>;
  /** Rama de cada evento (la central si no declara `branch`). */
  readonly branchOfEvent: ReadonlyMap<string, string>;
  /** Rama madre de cada rama (por `branchFrom` y, después, por `branches[].origin`). */
  readonly parentBranch: Map<string, string>;
  readonly usedBranches: ReadonlySet<string>;
}
