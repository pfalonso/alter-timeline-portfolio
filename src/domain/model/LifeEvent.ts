import type { LinkData, MediaData } from './LifeData';
import type { PartialDate } from './PartialDate';

export type Importance = 1 | 2 | 3;
export const MAIN_BRANCH = 'main';
export const DEFAULT_IMPORTANCE: Importance = 2;

export interface LifeEventProps {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly start: PartialDate;
  /** Fecha de fin; `null` si es puntual o si sigue en curso. */
  readonly end: PartialDate | null;
  /** `true` si `date.end` es "present". */
  readonly ongoing: boolean;
  readonly categoryIds: readonly string[];
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly organization?: string;
  readonly skills: readonly string[];
  readonly highlights: readonly string[];
  readonly links: readonly LinkData[];
  readonly media: readonly MediaData[];
  readonly importance: Importance;
  readonly branch: string;
  readonly branchFrom?: string;
  readonly isPrivate: boolean;
}

/** Evento vital ya validado y normalizado (valores por defecto aplicados). */
export class LifeEvent implements LifeEventProps {
  readonly id!: string;
  readonly title!: string;
  readonly subtitle?: string;
  readonly start!: PartialDate;
  readonly end!: PartialDate | null;
  readonly ongoing!: boolean;
  readonly categoryIds!: readonly string[];
  readonly summary!: string;
  readonly description?: string;
  readonly location?: string;
  readonly organization?: string;
  readonly skills!: readonly string[];
  readonly highlights!: readonly string[];
  readonly links!: readonly LinkData[];
  readonly media!: readonly MediaData[];
  readonly importance!: Importance;
  readonly branch!: string;
  readonly branchFrom?: string;
  readonly isPrivate!: boolean;

  constructor(props: LifeEventProps) {
    Object.assign(this, props);
    Object.freeze(this);
  }

  /** La primera categoría es la principal: da color al nodo. */
  get primaryCategoryId(): string {
    return this.categoryIds[0] ?? '';
  }

  /** `true` si el evento abarca un periodo (tiene fin o sigue en curso). */
  get isRange(): boolean {
    return this.ongoing || this.end !== null;
  }

  hasAnyCategory(ids: ReadonlySet<string>): boolean {
    return this.categoryIds.some((id) => ids.has(id));
  }

  /** Párrafos de la descripción larga (separados por una línea en blanco). */
  get paragraphs(): string[] {
    return (this.description ?? '')
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
  }

  /** Texto legible del periodo: "mar 2019 — actualidad". */
  formatDateRange(locale = 'es', presentLabel = 'actualidad'): string {
    const start = this.start.format(locale);
    if (this.ongoing) return `${start} — ${presentLabel}`;
    if (this.end && !this.end.equals(this.start)) return `${start} — ${this.end.format(locale)}`;
    return start;
  }
}
