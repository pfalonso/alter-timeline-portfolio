import type { Category } from './Category';
import type { LifeMetaData } from './LifeData';
import { MAIN_BRANCH, type LifeEvent } from './LifeEvent';
import { arcEndYear, arcStartYear, type LifeArc, type Story } from './LifeArc';
import { defaultLineStyle, type LifeLine, type LineStyle } from './LifeLine';
import type { PartialDate } from './PartialDate';

/** Fusión resuelta: la línea converge en `branch` a la altura de `event`. */
export interface ResolvedMerge {
  readonly branch: string;
  readonly event: LifeEvent;
}

/** Arcos y recorrido de la historia (opcionales). */
export interface TimelineNarrative {
  readonly arcs?: readonly LifeArc[];
  readonly story?: Story;
}

/** Agregado raíz: eventos ordenados cronológicamente, categorías y líneas vitales (ramas). */
export class Timeline {
  readonly events: readonly LifeEvent[];
  readonly categories: readonly Category[];
  /** Líneas declaradas en `branches` (pueden no tener eventos visibles). */
  readonly lines: readonly LifeLine[];
  /** Línea central (carril y = 0): `meta.mainBranch` o "main". */
  readonly mainBranch: string;
  private readonly eventsById = new Map<string, LifeEvent>();
  private readonly categoriesById = new Map<string, Category>();
  private readonly linesById = new Map<string, LifeLine>();
  /** Capítulos ordenados por inicio. */
  readonly arcs: readonly LifeArc[];
  /** Título del recorrido guiado, si lo hay. */
  readonly storyTitle?: string;
  /** Recorrido guiado: solo eventos presentes (los privados ocultos se quitan), en orden. */
  readonly storyPath: readonly string[];

  constructor(
    readonly meta: Readonly<LifeMetaData>,
    categories: readonly Category[],
    events: readonly LifeEvent[],
    /** "Hoy" para los eventos en curso; se inyecta para que todo sea determinista. */
    readonly now: PartialDate,
    lines: readonly LifeLine[] = [],
    narrative: TimelineNarrative = {},
  ) {
    this.mainBranch = meta.mainBranch ?? MAIN_BRANCH;
    this.lines = [...lines];
    for (const line of this.lines) this.linesById.set(line.id, line);
    this.categories = [...categories];
    this.events = [...events].sort((a, b) => a.start.compareTo(b.start) || a.id.localeCompare(b.id));
    for (const category of this.categories) this.categoriesById.set(category.id, category);
    for (const event of this.events) this.eventsById.set(event.id, event);
    this.arcs = [...(narrative.arcs ?? [])].sort((a, b) => a.start.compareTo(b.start) || a.id.localeCompare(b.id));
    this.storyTitle = narrative.story?.title;
    this.storyPath = (narrative.story?.path ?? []).filter((id) => this.eventsById.has(id));
  }

  /** Arco que contiene un año decimal: el último que ya ha empezado, si aún no ha terminado. */
  arcAt(decimalYear: number): LifeArc | undefined {
    let found: LifeArc | undefined;
    for (const arc of this.arcs) {
      if (arcStartYear(arc) <= decimalYear + 1e-9) found = arc;
      else break;
    }
    return found && decimalYear < arcEndYear(found) ? found : undefined;
  }

  /** Arco (capítulo) al que pertenece un evento según su fecha de inicio. */
  arcOf(event: LifeEvent): LifeArc | undefined {
    return this.arcAt(event.start.toDecimalYear());
  }

  getArc(id: string): LifeArc | undefined {
    return this.arcs.find((arc) => arc.id === id);
  }

  getEvent(id: string): LifeEvent | undefined {
    return this.eventsById.get(id);
  }

  getCategory(id: string): Category | undefined {
    return this.categoriesById.get(id);
  }

  categoriesOf(event: LifeEvent): Category[] {
    return event.categoryIds
      .map((id) => this.categoriesById.get(id))
      .filter((category): category is Category => category !== undefined);
  }

  primaryCategoryOf(event: LifeEvent): Category | undefined {
    return this.categoriesById.get(event.primaryCategoryId);
  }

  /**
   * Ids de las ramas con algún evento (propio o de unión, `alsoBranches`): la central siempre
   * primero, después las declaradas en `branches` (en su orden) y por último las demás en orden de
   * aparición. Los «caminos que no fueron» (`ghost`) no cuentan: no tienen eventos.
   */
  get branchIds(): string[] {
    const used = new Set(this.events.flatMap((event) => event.lineIds));
    const ids = new Set<string>([this.mainBranch]);
    for (const line of this.lines) if (used.has(line.id) && !line.ghost) ids.add(line.id);
    for (const event of this.events) ids.add(event.branch);
    return [...ids];
  }

  /** «Caminos que no fueron» cuyo evento de origen es visible. */
  get ghostLines(): LifeLine[] {
    return this.lines.filter((line) => line.ghost && line.originEventId !== undefined && this.eventsById.has(line.originEventId));
  }

  /** Eventos visibles por los que pasa una línea sin ser la dueña (nodos de unión). */
  unionsOf(branchId: string): LifeEvent[] {
    return this.events.filter((event) => event.alsoBranches.includes(branchId));
  }

  getLine(branchId: string): LifeLine | undefined {
    return this.linesById.get(branchId);
  }

  /** Lenguaje de forma de una línea: el declarado o el de por defecto según su id. */
  lineStyleOf(branchId: string): LineStyle {
    return this.linesById.get(branchId)?.style ?? defaultLineStyle(branchId);
  }

  /** Enlaces causales visibles: eventos a los que llevó `eventId` (en orden cronológico). */
  consequencesOf(eventId: string): LifeEvent[] {
    const event = this.eventsById.get(eventId);
    if (!event) return [];
    return this.events.filter((other) => event.ledTo.includes(other.id) && other.id !== eventId);
  }

  /** Enlaces causales visibles: eventos que llevaron a `eventId`. */
  causesOf(eventId: string): LifeEvent[] {
    return this.events.filter((other) => other.id !== eventId && other.ledTo.includes(eventId));
  }

  /** Todos los enlaces causales entre eventos visibles, en orden cronológico del origen. */
  get causalLinks(): { from: string; to: string }[] {
    return this.events.flatMap((event) => this.consequencesOf(event.id).map((target) => ({ from: event.id, to: target.id })));
  }

  /** Color de una línea: el declarado o el de la categoría principal de su primer evento. */
  lineColorOf(branchId: string): string | undefined {
    const declared = this.linesById.get(branchId)?.color;
    if (declared) return declared;
    const first = this.events.find((event) => event.branch === branchId);
    return first ? this.primaryCategoryOf(first)?.color : undefined;
  }

  /**
   * Evento visible del que nace una rama: `origin` de la línea si existe y es visible; si no, el
   * primer `branchFrom` de sus eventos. Nunca un evento de la propia rama ni para la central.
   */
  originOf(branchId: string): LifeEvent | undefined {
    const declared = this.linesById.get(branchId)?.originEventId;
    const candidates = [declared, this.events.find((event) => event.branch === branchId && event.branchFrom)?.branchFrom];
    for (const id of candidates) {
      const event = id === undefined ? undefined : this.eventsById.get(id);
      if (event && event.branch !== branchId) return event;
    }
    return undefined;
  }

  /** Fusión de una línea, solo si el evento de destino es visible y pertenece a la línea destino. */
  mergeOf(branchId: string): ResolvedMerge | undefined {
    const merge = this.linesById.get(branchId)?.mergeInto;
    if (!merge || merge.branch === branchId) return undefined;
    const event = this.eventsById.get(merge.eventId);
    return event && event.branch === merge.branch ? { branch: merge.branch, event } : undefined;
  }

  eventsOfBranch(branchId: string): LifeEvent[] {
    return this.events.filter((event) => event.branch === branchId);
  }

  /** Nº de eventos por categoría (un evento cuenta en todas sus categorías). */
  countByCategory(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const category of this.categories) counts.set(category.id, 0);
    for (const event of this.events) {
      for (const id of event.categoryIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  /** Rango temporal en años decimales, incluyendo "hoy" si hay eventos en curso. */
  get yearRange(): { start: number; end: number } {
    const now = this.now.toDecimalYear();
    if (this.events.length === 0) return { start: now - 1, end: now };
    let start = Infinity;
    let end = -Infinity;
    for (const event of this.events) {
      start = Math.min(start, event.start.toDecimalYear());
      const eventEnd = event.ongoing ? now : (event.end ?? event.start).toDecimalYear();
      end = Math.max(end, eventEnd, event.start.toDecimalYear());
    }
    return { start, end };
  }
}
