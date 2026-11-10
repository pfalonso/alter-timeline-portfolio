import type { Category } from './Category';
import type { LifeMetaData } from './LifeData';
import { MAIN_BRANCH, type LifeEvent } from './LifeEvent';
import type { PartialDate } from './PartialDate';

/** Agregado raíz: eventos ordenados cronológicamente, categorías y ramas. */
export class Timeline {
  readonly events: readonly LifeEvent[];
  readonly categories: readonly Category[];
  private readonly eventsById = new Map<string, LifeEvent>();
  private readonly categoriesById = new Map<string, Category>();

  constructor(
    readonly meta: Readonly<LifeMetaData>,
    categories: readonly Category[],
    events: readonly LifeEvent[],
    /** "Hoy" para los eventos en curso; se inyecta para que todo sea determinista. */
    readonly now: PartialDate,
  ) {
    this.categories = [...categories];
    this.events = [...events].sort((a, b) => a.start.compareTo(b.start) || a.id.localeCompare(b.id));
    for (const category of this.categories) this.categoriesById.set(category.id, category);
    for (const event of this.events) this.eventsById.set(event.id, event);
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

  /** Ids de rama en orden de aparición, con `main` siempre primero. */
  get branchIds(): string[] {
    const ids = new Set<string>([MAIN_BRANCH]);
    for (const event of this.events) ids.add(event.branch);
    return [...ids];
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
