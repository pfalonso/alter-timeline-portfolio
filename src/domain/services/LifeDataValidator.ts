import type { ValidationIssue } from '../errors/ValidationError';
import { ValidationError } from '../errors/ValidationError';
import type { LifeData } from '../model/LifeData';
import { MAIN_BRANCH } from '../model/LifeEvent';
import { PartialDate } from '../model/PartialDate';
import { isHttpUrl } from './safeUrl';

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

    this.validateMeta(input.meta, collector);
    const categoryIds = this.validateCategories(input.categories, collector);
    this.validateEvents(input.events, categoryIds, collector);

    const ok = collector.issues.length === 0;
    return ok ? { ok, issues: [], data: input as unknown as LifeData } : { ok, issues: collector.issues };
  }

  /** Devuelve los datos tipados o lanza `ValidationError` con todos los errores. */
  assertValid(input: unknown): LifeData {
    const result = this.validate(input);
    if (!result.ok || !result.data) throw new ValidationError(result.issues);
    return result.data;
  }

  private validateMeta(meta: unknown, c: IssueCollector): void {
    if (!isRecord(meta)) {
      c.add('meta', 'es obligatorio y debe ser un objeto');
      return;
    }
    c.requiredString(meta, 'owner', 'meta');
    c.requiredString(meta, 'title', 'meta');
    c.requiredString(meta, 'locale', 'meta');
    c.optionalString(meta, 'tagline', 'meta');
    c.links(meta.contact, 'meta.contact');
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

  private validateEvents(events: unknown, categoryIds: ReadonlySet<string>, c: IssueCollector): void {
    if (!Array.isArray(events)) {
      c.add('events', 'debe ser una lista de eventos');
      return;
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
    this.validateBranches(valid, ids, c);
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

  /** `branchFrom` existe, no apunta a la propia rama, es único por rama y no forma ciclos. */
  private validateBranches(events: { index: number; event: Rec }[], ids: ReadonlySet<string>, c: IssueCollector): void {
    const branchOfEvent = new Map<string, string>();
    for (const { event } of events) {
      if (typeof event.id === 'string') {
        branchOfEvent.set(event.id, typeof event.branch === 'string' ? event.branch : MAIN_BRANCH);
      }
    }
    const parentBranch = new Map<string, string>();
    const originOfBranch = new Map<string, string>();
    for (const { index, event } of events) {
      const from = event.branchFrom;
      if (typeof from !== 'string') continue;
      const path = `events[${index}].branchFrom`;
      const branch = typeof event.branch === 'string' ? event.branch : MAIN_BRANCH;
      if (!ids.has(from)) {
        c.add(path, `el evento "${from}" no existe`);
        continue;
      }
      if (from === event.id) {
        c.add(path, 'un evento no puede bifurcarse de sí mismo');
        continue;
      }
      if (branch === MAIN_BRANCH) {
        c.add(path, `la rama "${MAIN_BRANCH}" es el tronco y no puede tener branchFrom`);
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
      parentBranch.set(branch, branchOfEvent.get(from) ?? MAIN_BRANCH);
    }
    for (const branch of parentBranch.keys()) {
      const visited = new Set<string>([branch]);
      let current = parentBranch.get(branch);
      while (current !== undefined && current !== MAIN_BRANCH) {
        if (visited.has(current)) {
          c.add('events', `las ramas forman un ciclo de bifurcaciones (${[...visited].join(' → ')} → ${current})`);
          return;
        }
        visited.add(current);
        current = parentBranch.get(current);
      }
    }
  }
}
