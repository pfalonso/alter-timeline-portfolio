/** Conjunto inmutable de categorías activas en el filtro. */
export class CategorySelection {
  private readonly active: ReadonlySet<string>;

  private constructor(
    private readonly all: readonly string[],
    active: Iterable<string>,
  ) {
    const known = new Set(all);
    this.active = new Set([...active].filter((id) => known.has(id)));
  }

  static all(categoryIds: readonly string[]): CategorySelection {
    return new CategorySelection(categoryIds, categoryIds);
  }

  static none(categoryIds: readonly string[]): CategorySelection {
    return new CategorySelection(categoryIds, []);
  }

  /** `active === null` significa "sin filtro guardado" → todas. Los ids desconocidos se descartan. */
  static of(categoryIds: readonly string[], active: readonly string[] | null): CategorySelection {
    return new CategorySelection(categoryIds, active ?? categoryIds);
  }

  get activeIds(): ReadonlySet<string> {
    return this.active;
  }

  get isAll(): boolean {
    return this.active.size === this.all.length;
  }

  get isNone(): boolean {
    return this.active.size === 0;
  }

  has(id: string): boolean {
    return this.active.has(id);
  }

  toggle(id: string): CategorySelection {
    if (!this.all.includes(id)) return this;
    const next = new Set(this.active);
    if (!next.delete(id)) next.add(id);
    return new CategorySelection(this.all, next);
  }

  only(id: string): CategorySelection {
    return this.all.includes(id) ? new CategorySelection(this.all, [id]) : this;
  }

  selectAll(): CategorySelection {
    return CategorySelection.all(this.all);
  }

  selectNone(): CategorySelection {
    return CategorySelection.none(this.all);
  }

  /** Ids activos en el orden de definición; `null` si están todas (no hace falta persistir nada). */
  toPersisted(): string[] | null {
    return this.isAll ? null : this.all.filter((id) => this.active.has(id));
  }
}
