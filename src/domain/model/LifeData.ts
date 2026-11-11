/**
 * Forma "en crudo" del JSON de datos (contrato `LifeData`, schemaVersion 1).
 * Este fichero solo declara tipos.
 */
export interface LinkData {
  label: string;
  url: string;
}

export interface MediaData {
  type: 'image';
  url: string;
  alt: string;
}

export interface CategoryData {
  id: string;
  label: string;
  color: string;
  icon?: string;
  description?: string;
}

export interface LifeEventData {
  id: string;
  title: string;
  /** Título corto para los rótulos de la escena (máx. 40 caracteres). */
  shortTitle?: string;
  subtitle?: string;
  date: { start: string; end?: string };
  categories: string[];
  summary: string;
  description?: string;
  location?: string;
  organization?: string;
  skills?: string[];
  highlights?: string[];
  links?: LinkData[];
  media?: MediaData[];
  importance?: 1 | 2 | 3;
  branch?: string;
  branchFrom?: string;
  visibility?: 'public' | 'private';
}

export interface LifeMetaData {
  owner: string;
  title: string;
  tagline?: string;
  locale: string;
  contact?: LinkData[];
  /** Línea vital central (carril y = 0, la más brillante hoy). Por defecto "main". */
  mainBranch?: string;
}

/** Periodo en el que una línea vital está en foco (brilla más). */
export interface FocusPeriodData {
  start: string;
  /** Fecha de fin o "present"; si falta, el foco sigue hasta hoy. */
  end?: string;
  /** Intensidad del foco: 1 suave … 3 pleno (por defecto). */
  level?: 1 | 2 | 3;
}

/** Descripción de una línea vital (rama) con nombre, color, nacimiento, fusión y foco. */
export interface BranchInfoData {
  id: string;
  label: string;
  color?: string;
  description?: string;
  /** Evento donde nace la línea; prevalece sobre `event.branchFrom`. */
  origin?: string;
  /** La línea converge en `branch` a la altura de `event` (un evento de `branch`) y termina ahí. */
  mergeInto?: { branch: string; event: string };
  /** La línea sigue viva hasta hoy aunque su último evento haya terminado. */
  until?: 'present';
  focus?: FocusPeriodData[];
}

export interface LifeData {
  schemaVersion: 1;
  meta: LifeMetaData;
  categories: CategoryData[];
  events: LifeEventData[];
  branches?: BranchInfoData[];
}
