import type { LinkData, MediaData } from './LifeData';
import type { PartialDate } from './PartialDate';

export type Importance = 1 | 2 | 3;
export const MAIN_BRANCH = 'main';
export const DEFAULT_IMPORTANCE: Importance = 2;

export interface LifeEventProps {
  readonly id: string;
  readonly title: string;
  /** Versión corta del título para los rótulos de la escena (opcional). */
  readonly shortTitle?: string;
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
  /** Frase puente con el evento anterior de la historia. */
  readonly bridge?: string;
  /** Ids de los eventos a los que llevó este (enlaces causales). */
  readonly ledTo?: readonly string[];
  /** Otras líneas que pasan por este nodo (unión), sin la dueña ni duplicados. */
  readonly alsoBranches?: readonly string[];
  /** Proyecto o etapa vivo hoy. */
  readonly active?: boolean;
}

/** Evento vital ya validado y normalizado (valores por defecto aplicados). */
export class LifeEvent implements LifeEventProps {
  readonly id!: string;
  readonly title!: string;
  readonly shortTitle?: string;
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
  readonly bridge?: string;
  readonly ledTo!: readonly string[];
  readonly alsoBranches!: readonly string[];
  readonly active!: boolean;

  constructor(props: LifeEventProps) {
    Object.assign(this, { ...props, ledTo: props.ledTo ?? [], alsoBranches: props.alsoBranches ?? [], active: props.active ?? false });
    Object.freeze(this);
  }

  /** Texto del rótulo en la escena: el título corto si lo hay; si no, el título. */
  get labelTitle(): string {
    return this.shortTitle ?? this.title;
  }

  /** Todas las líneas que pasan por el nodo: la dueña primero y después las de `alsoBranches`. */
  get lineIds(): string[] {
    return [this.branch, ...this.alsoBranches];
  }

  /** `true` si es un nodo de unión (pasan por él varias líneas). */
  get isUnion(): boolean {
    return this.alsoBranches.length > 0;
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
