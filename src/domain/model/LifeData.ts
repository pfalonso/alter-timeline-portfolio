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
  /** Frase (≤ 160 caracteres) que enlaza con el evento anterior del recorrido de la historia. */
  bridge?: string;
  /** Eventos (posteriores o de la misma fecha, de cualquier línea) a los que este llevó. */
  ledTo?: string[];
  /** Otras líneas que pasan por este nodo (nodo de unión): convergen en él y vuelven a salir. */
  alsoBranches?: string[];
  /** Proyecto o etapa vivo hoy: el nodo late y su línea se sigue escribiendo hasta hoy. */
  active?: boolean;
}

/** Tramo en el que una línea no se dibuja: se disuelve tras `from` y renace en `to` (ids de eventos). */
export interface LinePauseData {
  from: string;
  to: string;
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
  /** Lenguaje de forma de sus nodos: rectilíneo, orgánico o neutro (por defecto, según el id). */
  style?: 'geometric' | 'organic' | 'neutral';
  /** «Camino que no fue»: nace en `origin`, recorre un paso tenue con su nombre y se disuelve. Sin eventos. */
  ghost?: boolean;
  /** Tramos en los que la línea no se dibuja (se disuelve tras `from` y renace en `to`). */
  pauses?: LinePauseData[];
}

/** Arco temporal (capítulo). Los arcos son contiguos y no se solapan. */
export interface ArcData {
  id: string;
  title: string;
  subtitle?: string;
  start: string;
  /** Fecha de fin o "present". */
  end: string;
  summary?: string;
}

/** Recorrido guiado: ids de eventos en orden cronológico. */
export interface StoryData {
  title?: string;
  path: string[];
}

export interface LifeData {
  schemaVersion: 1;
  meta: LifeMetaData;
  categories: CategoryData[];
  events: LifeEventData[];
  branches?: BranchInfoData[];
  arcs?: ArcData[];
  story?: StoryData;
}
